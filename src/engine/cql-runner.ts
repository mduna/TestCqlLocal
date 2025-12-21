import { Library, Executor, Repository, Results, CodeService } from 'cql-execution';
import { PatientSource } from 'cql-exec-fhir';
import * as fs from 'fs';
import * as path from 'path';

export interface ELMLibrary {
  library: {
    identifier: {
      id: string;
      version?: string;
    };
    schemaIdentifier?: {
      id: string;
      version: string;
    };
    usings?: {
      def: Array<{
        localIdentifier: string;
        uri: string;
        version?: string;
      }>;
    };
    statements?: {
      def: Array<{
        name: string;
        context?: string;
        expression?: unknown;
      }>;
    };
  };
}

export interface ExecutionResult {
  patientId: string;
  libraryName: string;
  results: Record<string, unknown>;
}

export interface CQLRunnerOptions {
  elmPath: string;
  patientSource: PatientSource;
  codeService?: CodeService;
  parameters?: Record<string, unknown>;
  includedLibraries?: ELMLibrary[];
}

/**
 * Load an ELM JSON file
 */
export function loadELM(filePath: string): ELMLibrary {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  return JSON.parse(content) as ELMLibrary;
}

/**
 * Load all ELM files from a directory
 */
export function loadELMFromDirectory(elmDir: string): ELMLibrary[] {
  const absoluteDir = path.resolve(elmDir);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const files = fs.readdirSync(absoluteDir).filter(f => f.endsWith('.json'));
  return files.map(file => loadELM(path.join(absoluteDir, file)));
}

/**
 * Get list of available ELM libraries
 */
export function getELMList(elmDir: string): Array<{ id: string; version?: string; filePath: string }> {
  const absoluteDir = path.resolve(elmDir);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const files = fs.readdirSync(absoluteDir).filter(f => f.endsWith('.json'));
  const libraries: Array<{ id: string; version?: string; filePath: string }> = [];

  for (const file of files) {
    try {
      const elm = loadELM(path.join(absoluteDir, file));
      libraries.push({
        id: elm.library.identifier.id,
        version: elm.library.identifier.version,
        filePath: file,
      });
    } catch {
      // Skip invalid files
    }
  }

  return libraries;
}

/**
 * Get statement names from an ELM library
 */
export function getStatements(elm: ELMLibrary): string[] {
  return elm.library.statements?.def.map(s => s.name) || [];
}

/**
 * Execute CQL against patient data
 */
export async function executeCQL(options: CQLRunnerOptions): Promise<ExecutionResult[]> {
  const mainELM = loadELM(options.elmPath);

  // Create repository with all libraries
  const allLibraries = [mainELM, ...(options.includedLibraries || [])];
  const repository = new Repository(allLibraries);

  // Create main library
  const library = new Library(mainELM, repository);

  // Create executor
  const executor = new Executor(library, options.codeService || undefined, options.parameters || undefined);

  // Execute against all patients (async)
  const results: Results = await executor.exec(options.patientSource);

  // Format results
  const executionResults: ExecutionResult[] = [];

  if (results.patientResults) {
    for (const patientId of Object.keys(results.patientResults)) {
      const patientResult = results.patientResults[patientId];
      executionResults.push({
        patientId,
        libraryName: mainELM.library.identifier.id,
        results: patientResult,
      });
    }
  }

  return executionResults;
}

/**
 * Execute a specific expression from a CQL library
 */
export async function executeExpression(
  options: CQLRunnerOptions,
  expressionName: string
): Promise<unknown[]> {
  const results = await executeCQL(options);
  return results.map((r: ExecutionResult) => ({
    patientId: r.patientId,
    [expressionName]: r.results[expressionName],
  }));
}

/**
 * Validate ELM structure
 */
export function validateELM(elm: ELMLibrary): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!elm.library) {
    errors.push('Missing "library" property');
  }

  if (!elm.library?.identifier) {
    errors.push('Missing library identifier');
  }

  if (!elm.library?.identifier?.id) {
    errors.push('Missing library identifier id');
  }

  // Check for QI-Core or FHIR usage
  const usings = elm.library?.usings?.def || [];
  const hasFHIR = usings.some(u => u.localIdentifier === 'FHIR' || u.uri?.includes('fhir'));
  const hasQICore = usings.some(u => u.localIdentifier === 'QICore' || u.uri?.includes('qicore'));

  if (!hasFHIR && !hasQICore) {
    errors.push('Warning: No FHIR or QICore model usage detected');
  }

  return {
    valid: errors.length === 0 || errors.every(e => e.startsWith('Warning')),
    errors,
  };
}
