import { PatientSource } from 'cql-exec-fhir';
import * as fs from 'fs';
import * as path from 'path';

export interface FHIRBundle {
  resourceType: 'Bundle';
  type: string;
  entry?: Array<{
    resource: Record<string, unknown>;
  }>;
}

export interface PatientInfo {
  id: string;
  name: string;
  birthDate: string;
  gender: string;
  filePath: string;
}

/**
 * Load a FHIR Bundle from a JSON file
 */
export function loadBundle(filePath: string): FHIRBundle {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  return JSON.parse(content) as FHIRBundle;
}

/**
 * Load all patient bundles from the patients directory
 */
export function loadAllPatients(patientsDir: string): FHIRBundle[] {
  const absoluteDir = path.resolve(patientsDir);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const files = fs.readdirSync(absoluteDir).filter(f => f.endsWith('.json'));
  return files.map(file => loadBundle(path.join(absoluteDir, file)));
}

/**
 * Get patient info from bundles for listing
 */
export function getPatientList(patientsDir: string): PatientInfo[] {
  const absoluteDir = path.resolve(patientsDir);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const files = fs.readdirSync(absoluteDir).filter(f => f.endsWith('.json'));
  const patients: PatientInfo[] = [];

  for (const file of files) {
    const filePath = path.join(absoluteDir, file);
    const bundle = loadBundle(filePath);

    const patientResource = bundle.entry?.find(
      e => (e.resource as Record<string, unknown>).resourceType === 'Patient'
    )?.resource as Record<string, unknown> | undefined;

    if (patientResource) {
      const name = extractPatientName(patientResource);
      patients.push({
        id: (patientResource.id as string) || 'unknown',
        name,
        birthDate: (patientResource.birthDate as string) || 'unknown',
        gender: (patientResource.gender as string) || 'unknown',
        filePath: file,
      });
    }
  }

  return patients;
}

/**
 * Extract patient name from FHIR Patient resource
 */
function extractPatientName(patient: Record<string, unknown>): string {
  const nameArray = patient.name as Array<{
    given?: string[];
    family?: string;
    text?: string;
  }> | undefined;

  if (!nameArray || nameArray.length === 0) {
    return 'Unknown';
  }

  const name = nameArray[0];
  if (name.text) {
    return name.text;
  }

  const given = name.given?.join(' ') || '';
  const family = name.family || '';
  return `${given} ${family}`.trim() || 'Unknown';
}

/**
 * Create a PatientSource from FHIR bundles for CQL execution
 */
export function createPatientSource(bundles: FHIRBundle[]): PatientSource {
  const patientSource = PatientSource.FHIRv401();
  patientSource.loadBundles(bundles);
  return patientSource;
}

/**
 * Create a PatientSource from a single bundle file
 */
export function createPatientSourceFromFile(filePath: string): PatientSource {
  const bundle = loadBundle(filePath);
  return createPatientSource([bundle]);
}

/**
 * Create a PatientSource from all bundles in a directory
 */
export function createPatientSourceFromDirectory(patientsDir: string): PatientSource {
  const bundles = loadAllPatients(patientsDir);
  return createPatientSource(bundles);
}
