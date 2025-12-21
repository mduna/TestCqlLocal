/**
 * ELM Extractor for MADiE FHIR Library Resources
 *
 * Extracts raw ELM JSON from FHIR Library resources exported by MADiE.
 * MADiE exports CQL as FHIR Library resources with base64-encoded content.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ELMLibrary } from '../engine/cql-runner.js';

/**
 * FHIR Library resource structure (subset of fields we need)
 */
interface FHIRLibrary {
  resourceType: 'Library';
  id: string;
  name: string;
  version: string;
  content?: Array<{
    contentType: string;
    data: string; // Base64 encoded
  }>;
  relatedArtifact?: Array<{
    type: string;
    display?: string;
    resource?: string;
  }>;
}

/**
 * Extract raw ELM JSON from a FHIR Library resource file.
 *
 * @param libraryPath - Path to the FHIR Library JSON file
 * @returns The extracted ELM library
 * @throws Error if library cannot be parsed or ELM content not found
 */
export function extractELMFromFHIRLibrary(libraryPath: string): ELMLibrary {
  const absolutePath = path.resolve(libraryPath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const fhirLibrary: FHIRLibrary = JSON.parse(content);

  if (fhirLibrary.resourceType !== 'Library') {
    throw new Error(`Expected Library resource, got ${fhirLibrary.resourceType}`);
  }

  if (!fhirLibrary.content || fhirLibrary.content.length === 0) {
    throw new Error(`Library ${fhirLibrary.name} has no content`);
  }

  // Find the ELM JSON content
  const elmContent = fhirLibrary.content.find(
    c => c.contentType === 'application/elm+json'
  );

  if (!elmContent) {
    const availableTypes = fhirLibrary.content.map(c => c.contentType).join(', ');
    throw new Error(
      `Library ${fhirLibrary.name} has no ELM JSON content. Available: ${availableTypes}`
    );
  }

  // Decode base64 content
  const decodedContent = Buffer.from(elmContent.data, 'base64').toString('utf-8');

  // Parse as ELM
  const elm: ELMLibrary = JSON.parse(decodedContent);

  // Validate ELM structure
  if (!elm.library || !elm.library.identifier) {
    throw new Error(`Invalid ELM structure in ${fhirLibrary.name}`);
  }

  return elm;
}

/**
 * Get library dependencies from a FHIR Library resource.
 *
 * @param libraryPath - Path to the FHIR Library JSON file
 * @returns Array of library identifiers that this library depends on
 */
export function getLibraryDependencies(libraryPath: string): Array<{ name: string; version?: string }> {
  const absolutePath = path.resolve(libraryPath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const fhirLibrary: FHIRLibrary = JSON.parse(content);

  const dependencies: Array<{ name: string; version?: string }> = [];

  if (!fhirLibrary.relatedArtifact) {
    return dependencies;
  }

  for (const artifact of fhirLibrary.relatedArtifact) {
    if (artifact.type === 'depends-on' && artifact.resource) {
      // Resource format: "Library/LibraryName|version" or URL
      const resource = artifact.resource;

      // Try to extract library name and version
      let name: string | undefined;
      let version: string | undefined;

      if (resource.includes('Library/')) {
        const libPart = resource.split('Library/')[1];
        if (libPart.includes('|')) {
          [name, version] = libPart.split('|');
        } else {
          name = libPart;
        }
      } else if (artifact.display) {
        // Fallback to display name
        name = artifact.display;
      }

      if (name) {
        dependencies.push({ name, version });
      }
    }
  }

  return dependencies;
}

/**
 * Get basic info about a FHIR Library without full ELM extraction.
 *
 * @param libraryPath - Path to the FHIR Library JSON file
 * @returns Library metadata
 */
export function getLibraryInfo(libraryPath: string): { name: string; version: string; id: string } {
  const absolutePath = path.resolve(libraryPath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const fhirLibrary: FHIRLibrary = JSON.parse(content);

  return {
    id: fhirLibrary.id,
    name: fhirLibrary.name,
    version: fhirLibrary.version
  };
}
