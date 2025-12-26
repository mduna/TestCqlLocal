#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Common Code System Definitions

This module defines URLs for standard healthcare code systems used in FHIR resources.
"""

# =============================================================================
# STANDARD TERMINOLOGY CODE SYSTEMS
# =============================================================================

CODE_SYSTEMS = {
    # Clinical Terminologies
    "SNOMED": "http://snomed.info/sct",
    "LOINC": "http://loinc.org",
    "RXNORM": "http://www.nlm.nih.gov/research/umls/rxnorm",
    "ICD10CM": "http://hl7.org/fhir/sid/icd-10-cm",
    "ICD10PCS": "http://www.cms.gov/Medicare/Coding/ICD10",
    "CPT": "http://www.ama-assn.org/go/cpt",
    "HCPCS": "https://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets",
    "CVX": "http://hl7.org/fhir/sid/cvx",
    "NDC": "http://hl7.org/fhir/sid/ndc",

    # CDC/NHSN Code Systems
    "HSLOC": "https://www.cdc.gov/nhsn/cdaportal/terminology/codesystem/hsloc.html",
    "CDCNHSN": "http://cdc.gov/nhsn/cdaportal/terminology/codesystem/cdcnhsn.html",

    # HL7 Code Systems
    "ActCode": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
    "ActPriority": "http://terminology.hl7.org/CodeSystem/v3-ActPriority",
    "NullFlavor": "http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
    "RoleCode": "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
    "MaritalStatus": "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
    "AdministrativeGender": "http://hl7.org/fhir/administrative-gender",

    # Observation Categories
    "ObservationCategory": "http://terminology.hl7.org/CodeSystem/observation-category",

    # Condition Categories and Status
    "ConditionCategory": "http://terminology.hl7.org/CodeSystem/condition-category",
    "USCoreConditionCategory": "http://hl7.org/fhir/us/core/CodeSystem/condition-category",
    "ConditionClinicalStatus": "http://terminology.hl7.org/CodeSystem/condition-clinical",
    "ConditionVerificationStatus": "http://terminology.hl7.org/CodeSystem/condition-ver-status",

    # Medication Categories
    "MedicationRequestCategory": "http://terminology.hl7.org/CodeSystem/medicationrequest-category",
    "MedicationAdminCategory": "http://terminology.hl7.org/CodeSystem/medication-admin-category",
    "MedicationAdminPerformFunction": "http://terminology.hl7.org/CodeSystem/med-admin-perform-function",
    "MedicationRequestCourseOfTherapy": "http://terminology.hl7.org/CodeSystem/medicationrequest-course-of-therapy",

    # Encounter Related
    "EncounterStatus": "http://hl7.org/fhir/encounter-status",
    "DischargeDisposition": "http://terminology.hl7.org/CodeSystem/discharge-disposition",
    "DiagnosisRole": "http://terminology.hl7.org/CodeSystem/diagnosis-role",

    # Coverage Related
    "CoverageClass": "http://terminology.hl7.org/CodeSystem/coverage-class",
    "SubscriberRelationship": "http://terminology.hl7.org/CodeSystem/subscriber-relationship",

    # Diagnostic Report Categories
    "DiagnosticServiceSection": "http://terminology.hl7.org/CodeSystem/v2-0074",

    # Location
    "LocationPhysicalType": "http://terminology.hl7.org/CodeSystem/location-physical-type",
    "LocationOperationalStatus": "http://terminology.hl7.org/CodeSystem/v2-0116",

    # Identifiers
    "IdentifierType": "http://terminology.hl7.org/CodeSystem/v2-0203",
    "NPI": "http://hl7.org/fhir/sid/us-npi",

    # Reference Range
    "ReferenceRangeMeaning": "http://terminology.hl7.org/CodeSystem/referencerange-meaning",

    # Observation Interpretation
    "ObservationInterpretation": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",

    # Data Absent Reason
    "DataAbsentReason": "http://terminology.hl7.org/CodeSystem/data-absent-reason",

    # Dose Rate Type
    "DoseRateType": "http://terminology.hl7.org/CodeSystem/dose-rate-type",

    # Contact Relationship
    "ContactRelationship": "http://terminology.hl7.org/CodeSystem/v2-0131",

    # Units of Measure
    "UCUM": "http://unitsofmeasure.org",

    # Race and Ethnicity (US Core)
    "RaceEthnicity": "urn:oid:2.16.840.1.113883.6.238",

    # Language
    "Language": "urn:ietf:bcp:47",

    # Measure Population
    "MeasurePopulation": "http://terminology.hl7.org/CodeSystem/measure-population",
}

# =============================================================================
# COMMON CODES (Pre-defined for convenience)
# =============================================================================

COMMON_CODES = {
    # Observation Categories
    "laboratory": {
        "system": CODE_SYSTEMS["ObservationCategory"],
        "code": "laboratory",
        "display": "Laboratory"
    },
    "vital-signs": {
        "system": CODE_SYSTEMS["ObservationCategory"],
        "code": "vital-signs",
        "display": "Vital Signs"
    },
    "social-history": {
        "system": CODE_SYSTEMS["ObservationCategory"],
        "code": "social-history",
        "display": "Social History"
    },
    "imaging": {
        "system": CODE_SYSTEMS["ObservationCategory"],
        "code": "imaging",
        "display": "Imaging"
    },
    "procedure": {
        "system": CODE_SYSTEMS["ObservationCategory"],
        "code": "procedure",
        "display": "Procedure"
    },
    "survey": {
        "system": CODE_SYSTEMS["ObservationCategory"],
        "code": "survey",
        "display": "Survey"
    },

    # Condition Categories
    "encounter-diagnosis": {
        "system": CODE_SYSTEMS["ConditionCategory"],
        "code": "encounter-diagnosis",
        "display": "Encounter Diagnosis"
    },
    "problem-list-item": {
        "system": CODE_SYSTEMS["ConditionCategory"],
        "code": "problem-list-item",
        "display": "Problem List Item"
    },

    # Condition Clinical Status
    "condition-active": {
        "system": CODE_SYSTEMS["ConditionClinicalStatus"],
        "code": "active",
        "display": "Active"
    },
    "condition-resolved": {
        "system": CODE_SYSTEMS["ConditionClinicalStatus"],
        "code": "resolved",
        "display": "Resolved"
    },

    # Condition Verification Status
    "condition-confirmed": {
        "system": CODE_SYSTEMS["ConditionVerificationStatus"],
        "code": "confirmed",
        "display": "Confirmed"
    },

    # Encounter Class Codes (ActCode)
    "IMP": {
        "system": CODE_SYSTEMS["ActCode"],
        "code": "IMP",
        "display": "inpatient encounter"
    },
    "ACUTE": {
        "system": CODE_SYSTEMS["ActCode"],
        "code": "ACUTE",
        "display": "inpatient acute"
    },
    "NONAC": {
        "system": CODE_SYSTEMS["ActCode"],
        "code": "NONAC",
        "display": "inpatient non-acute"
    },
    "SS": {
        "system": CODE_SYSTEMS["ActCode"],
        "code": "SS",
        "display": "short stay"
    },
    "EMER": {
        "system": CODE_SYSTEMS["ActCode"],
        "code": "EMER",
        "display": "emergency"
    },
    "OBSENC": {
        "system": CODE_SYSTEMS["ActCode"],
        "code": "OBSENC",
        "display": "observation encounter"
    },
    "AMB": {
        "system": CODE_SYSTEMS["ActCode"],
        "code": "AMB",
        "display": "ambulatory"
    },

    # Medication Request Categories
    "med-inpatient": {
        "system": CODE_SYSTEMS["MedicationRequestCategory"],
        "code": "inpatient",
        "display": "Inpatient"
    },
    "med-outpatient": {
        "system": CODE_SYSTEMS["MedicationRequestCategory"],
        "code": "outpatient",
        "display": "Outpatient"
    },

    # Diagnostic Report Categories (LOINC-based)
    "radiology": {
        "system": CODE_SYSTEMS["LOINC"],
        "code": "LP29684-5",
        "display": "Radiology"
    },
    "pathology": {
        "system": CODE_SYSTEMS["LOINC"],
        "code": "LP7839-6",
        "display": "Pathology"
    },
    "cardiology": {
        "system": CODE_SYSTEMS["LOINC"],
        "code": "LP29708-2",
        "display": "Cardiology"
    },

    # Discharge Disposition
    "discharge-home": {
        "system": CODE_SYSTEMS["DischargeDisposition"],
        "code": "home",
        "display": "Home"
    },

    # Diagnosis Role
    "admission-diagnosis": {
        "system": CODE_SYSTEMS["DiagnosisRole"],
        "code": "AD",
        "display": "Admission diagnosis"
    },

    # Data Absent Reason
    "not-performed": {
        "system": CODE_SYSTEMS["DataAbsentReason"],
        "code": "not-performed",
        "display": "Not Performed"
    },

    # Observation Interpretation
    "normal": {
        "system": CODE_SYSTEMS["ObservationInterpretation"],
        "code": "N",
        "display": "Normal"
    },
}

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_code_system_url(name: str) -> str:
    """Get the URL for a code system by name"""
    return CODE_SYSTEMS.get(name)

def get_common_code(name: str) -> dict:
    """Get a common code by name"""
    return COMMON_CODES.get(name)

def create_coding(system: str, code: str, display: str = None) -> dict:
    """Create a FHIR Coding object"""
    coding = {
        "system": system,
        "code": code
    }
    if display:
        coding["display"] = display
    return coding

def create_codeable_concept(system: str, code: str, display: str = None) -> dict:
    """Create a FHIR CodeableConcept object"""
    return {
        "coding": [create_coding(system, code, display)]
    }
