#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VSAC Client

Client for downloading value sets from the VSAC FHIR API.
Provides code lookup utilities for test case generation.
"""

import os
import re
import json
import time
import logging
import requests
from typing import Dict, List, Optional, Tuple

# Configure logging
logger = logging.getLogger(__name__)


# =============================================================================
# CUSTOM EXCEPTIONS
# =============================================================================

class VSACError(Exception):
    """Base exception for VSAC-related errors"""
    pass


class VSACAuthenticationError(VSACError):
    """Raised when VSAC API authentication fails"""
    pass


class VSACNotFoundError(VSACError):
    """Raised when a valueset is not found in VSAC"""
    def __init__(self, oid: str, message: str = None):
        self.oid = oid
        super().__init__(message or f"ValueSet not found: {oid}")


class VSACRateLimitError(VSACError):
    """Raised when VSAC API rate limit is exceeded"""
    def __init__(self, retry_after: int = None):
        self.retry_after = retry_after
        msg = "VSAC API rate limit exceeded"
        if retry_after:
            msg += f". Retry after {retry_after} seconds"
        super().__init__(msg)


class VSACConnectionError(VSACError):
    """Raised when connection to VSAC fails"""
    pass


class VSACResponseError(VSACError):
    """Raised when VSAC returns an unexpected response"""
    def __init__(self, status_code: int, response_body: str = None):
        self.status_code = status_code
        self.response_body = response_body
        super().__init__(f"VSAC returned status {status_code}: {response_body[:200] if response_body else 'No response body'}")


class VSACValidationError(VSACError):
    """Raised when input validation fails"""
    pass


class CacheError(VSACError):
    """Raised when cache operations fail"""
    pass


# =============================================================================
# VSAC CLIENT
# =============================================================================

class VSACClient:
    """
    Client for interacting with the VSAC (Value Set Authority Center) FHIR API.

    Features:
    - Automatic retry with exponential backoff
    - In-memory and file-based caching
    - Comprehensive error handling
    - Input validation

    Usage:
        client = VSACClient(api_key="your-api-key")
        codes = client.get_codes("2.16.840.1.113883.3.666.5.307")
        sample = client.get_sample_code("2.16.840.1.113883.3.666.5.307")

    Error Handling:
        try:
            codes = client.get_codes("invalid-oid")
        except VSACNotFoundError as e:
            print(f"ValueSet not found: {e.oid}")
        except VSACAuthenticationError:
            print("Invalid API key")
        except VSACError as e:
            print(f"VSAC error: {e}")
    """

    VSAC_FHIR_URL = "https://cts.nlm.nih.gov/fhir/ValueSet"
    OID_PATTERN = re.compile(r'^[\d.]+$')
    DEFAULT_TIMEOUT = 30
    MAX_RETRIES = 3
    RETRY_BACKOFF_FACTOR = 2

    def __init__(self, api_key: str, cache_dir: str = None, timeout: int = None,
                 max_retries: int = None, verbose: bool = True):
        """
        Initialize the VSAC client.

        Args:
            api_key: VSAC API key (Basic auth). Required.
            cache_dir: Optional directory to cache downloaded valuesets
            timeout: Request timeout in seconds (default: 30)
            max_retries: Maximum retry attempts for failed requests (default: 3)
            verbose: Whether to print status messages (default: True)

        Raises:
            VSACValidationError: If api_key is empty or invalid
        """
        if not api_key or not isinstance(api_key, str):
            raise VSACValidationError("API key is required and must be a non-empty string")

        self.api_key = api_key.strip()
        self.cache_dir = cache_dir
        self.cache = {}  # In-memory cache
        self.timeout = timeout or self.DEFAULT_TIMEOUT
        self.max_retries = max_retries if max_retries is not None else self.MAX_RETRIES
        self.verbose = verbose

        # Statistics tracking
        self._stats = {
            "downloads": 0,
            "cache_hits": 0,
            "failures": 0,
            "retries": 0
        }

        if cache_dir:
            try:
                os.makedirs(cache_dir, exist_ok=True)
            except OSError as e:
                raise CacheError(f"Failed to create cache directory '{cache_dir}': {e}")

    def _log(self, message: str, level: str = "info"):
        """Log a message if verbose mode is enabled"""
        if self.verbose:
            print(message)
        getattr(logger, level)(message)

    def _validate_oid(self, oid: str) -> str:
        """
        Validate and normalize an OID.

        Args:
            oid: The OID to validate

        Returns:
            Normalized OID string

        Raises:
            VSACValidationError: If OID is invalid
        """
        if not oid or not isinstance(oid, str):
            raise VSACValidationError("OID is required and must be a non-empty string")

        oid = oid.strip()

        if not self.OID_PATTERN.match(oid):
            raise VSACValidationError(
                f"Invalid OID format: '{oid}'. OID must contain only digits and periods (e.g., '2.16.840.1.113883.3.666.5.307')"
            )

        return oid

    def _get_cache_path(self, oid: str) -> Optional[str]:
        """Get the cache file path for a valueset OID"""
        if self.cache_dir:
            # Sanitize OID for filename
            safe_oid = oid.replace(".", "_")
            return os.path.join(self.cache_dir, f"{safe_oid}.json")
        return None

    def _load_from_cache(self, oid: str) -> Optional[Dict]:
        """
        Load valueset from file cache.

        Args:
            oid: The valueset OID

        Returns:
            Cached valueset dict, or None if not cached

        Raises:
            CacheError: If cache file exists but cannot be read
        """
        cache_path = self._get_cache_path(oid)
        if not cache_path or not os.path.exists(cache_path):
            return None

        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self._stats["cache_hits"] += 1
                return data
        except json.JSONDecodeError as e:
            logger.warning(f"Corrupted cache file for {oid}, will re-download: {e}")
            # Remove corrupted cache file
            try:
                os.remove(cache_path)
            except OSError:
                pass
            return None
        except OSError as e:
            raise CacheError(f"Failed to read cache file for {oid}: {e}")

    def _save_to_cache(self, oid: str, valueset: Dict):
        """
        Save valueset to file cache.

        Args:
            oid: The valueset OID
            valueset: The valueset data to cache

        Raises:
            CacheError: If cache file cannot be written
        """
        cache_path = self._get_cache_path(oid)
        if not cache_path:
            return

        try:
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(valueset, f, indent=2)
        except OSError as e:
            raise CacheError(f"Failed to write cache file for {oid}: {e}")

    def _make_request(self, url: str, headers: Dict) -> Tuple[int, Optional[Dict], str]:
        """
        Make an HTTP request with retry logic.

        Args:
            url: The URL to request
            headers: Request headers

        Returns:
            Tuple of (status_code, json_response, raw_text)

        Raises:
            VSACConnectionError: If connection fails after all retries
        """
        last_exception = None

        for attempt in range(self.max_retries + 1):
            try:
                response = requests.get(url, headers=headers, timeout=self.timeout)

                # Handle rate limiting
                if response.status_code == 429:
                    retry_after = int(response.headers.get('Retry-After', 60))
                    if attempt < self.max_retries:
                        self._stats["retries"] += 1
                        self._log(f"  Rate limited. Waiting {retry_after}s before retry...")
                        time.sleep(retry_after)
                        continue
                    raise VSACRateLimitError(retry_after)

                # Parse JSON response
                try:
                    json_response = response.json() if response.text else None
                except json.JSONDecodeError:
                    json_response = None

                return response.status_code, json_response, response.text

            except requests.exceptions.Timeout:
                last_exception = VSACConnectionError(f"Request timed out after {self.timeout}s")
            except requests.exceptions.ConnectionError as e:
                last_exception = VSACConnectionError(f"Connection failed: {e}")
            except requests.exceptions.RequestException as e:
                last_exception = VSACConnectionError(f"Request failed: {e}")

            # Retry with backoff
            if attempt < self.max_retries:
                self._stats["retries"] += 1
                wait_time = self.RETRY_BACKOFF_FACTOR ** attempt
                self._log(f"  Request failed, retrying in {wait_time}s... (attempt {attempt + 1}/{self.max_retries})")
                time.sleep(wait_time)

        raise last_exception

    def download_valueset(self, oid: str, force_refresh: bool = False) -> Dict:
        """
        Download a value set from VSAC FHIR API.

        Args:
            oid: The OID of the valueset (e.g., "2.16.840.1.113883.3.666.5.307")
            force_refresh: If True, bypass cache and re-download

        Returns:
            The valueset JSON dict

        Raises:
            VSACValidationError: If OID format is invalid
            VSACAuthenticationError: If API key is invalid
            VSACNotFoundError: If valueset does not exist
            VSACRateLimitError: If rate limit is exceeded
            VSACConnectionError: If connection fails
            VSACResponseError: For other HTTP errors
        """
        oid = self._validate_oid(oid)

        # Check in-memory cache
        if not force_refresh and oid in self.cache:
            self._log(f"  [CACHE] Using in-memory cache for {oid}")
            return self.cache[oid]

        # Check file cache
        if not force_refresh:
            cached = self._load_from_cache(oid)
            if cached:
                self.cache[oid] = cached
                self._log(f"  [CACHE] Loaded from file cache: {oid}")
                return cached

        # Download from VSAC
        url = f"{self.VSAC_FHIR_URL}/{oid}/$expand"
        headers = {
            "Accept": "application/fhir+json",
            "Authorization": f"Basic {self.api_key}"
        }

        self._log(f"Downloading valueset {oid}...")

        status_code, json_response, raw_text = self._make_request(url, headers)

        # Handle response codes
        if status_code == 200:
            if not json_response:
                raise VSACResponseError(status_code, "Empty response body")

            self._stats["downloads"] += 1
            self.cache[oid] = json_response
            self._save_to_cache(oid, json_response)
            self._log(f"  [OK] Successfully downloaded {oid}")
            return json_response

        elif status_code == 401:
            self._stats["failures"] += 1
            raise VSACAuthenticationError(
                "Authentication failed. Please verify your VSAC API key is valid and properly encoded."
            )

        elif status_code == 403:
            self._stats["failures"] += 1
            raise VSACAuthenticationError(
                "Access forbidden. Your API key may not have permission to access this valueset."
            )

        elif status_code == 404:
            self._stats["failures"] += 1
            # Check if it's a FHIR OperationOutcome
            if json_response and json_response.get("resourceType") == "OperationOutcome":
                issues = json_response.get("issue", [])
                if issues:
                    details = issues[0].get("diagnostics", "ValueSet not found")
                    raise VSACNotFoundError(oid, f"ValueSet {oid} not found: {details}")
            raise VSACNotFoundError(oid)

        elif status_code == 429:
            # Should be handled in _make_request, but just in case
            self._stats["failures"] += 1
            raise VSACRateLimitError()

        else:
            self._stats["failures"] += 1
            raise VSACResponseError(status_code, raw_text)

    def extract_codes(self, valueset_json: Dict) -> List[Dict]:
        """
        Extract codes from a ValueSet expansion.

        Args:
            valueset_json: The valueset JSON dict

        Returns:
            List of code dicts [{system, code, display}]

        Raises:
            VSACValidationError: If valueset_json is invalid
        """
        if valueset_json is None:
            raise VSACValidationError("valueset_json cannot be None")

        if not isinstance(valueset_json, dict):
            raise VSACValidationError(f"valueset_json must be a dict, got {type(valueset_json).__name__}")

        codes = []

        # Check for expansion
        expansion = valueset_json.get("expansion")
        if not expansion:
            logger.warning(f"ValueSet has no expansion: {valueset_json.get('id', 'unknown')}")
            return codes

        contains = expansion.get("contains")
        if not contains:
            logger.warning(f"ValueSet expansion has no contains: {valueset_json.get('id', 'unknown')}")
            return codes

        if not isinstance(contains, list):
            raise VSACValidationError(f"expansion.contains must be a list, got {type(contains).__name__}")

        for concept in contains:
            if not isinstance(concept, dict):
                logger.warning(f"Skipping invalid concept: {concept}")
                continue

            code_entry = {
                "system": concept.get("system"),
                "code": concept.get("code"),
                "display": concept.get("display")
            }

            # Validate required fields
            if not code_entry["system"] or not code_entry["code"]:
                logger.warning(f"Skipping concept with missing system or code: {concept}")
                continue

            codes.append(code_entry)

        return codes

    def get_codes(self, oid: str, force_refresh: bool = False) -> List[Dict]:
        """
        Get list of codes for a valueset.

        Args:
            oid: The OID of the valueset
            force_refresh: If True, bypass cache and re-download

        Returns:
            List of code dicts [{system, code, display}]

        Raises:
            VSACError: For any VSAC-related errors
        """
        valueset = self.download_valueset(oid, force_refresh)
        return self.extract_codes(valueset)

    def get_sample_code(self, oid: str, index: int = 0) -> Optional[Dict]:
        """
        Get a single sample code from a valueset.

        Args:
            oid: The OID of the valueset
            index: Index of the code to return (default: first code)

        Returns:
            Code dict {system, code, display}, or None if not found

        Raises:
            VSACValidationError: If index is negative
            VSACError: For any VSAC-related errors
        """
        if index < 0:
            raise VSACValidationError(f"Index must be non-negative, got {index}")

        codes = self.get_codes(oid)
        if codes and len(codes) > index:
            return codes[index]

        if codes:
            logger.warning(f"Index {index} out of range for valueset {oid} (has {len(codes)} codes)")
        return None

    def get_valueset_info(self, oid: str) -> Dict:
        """
        Get metadata about a valueset.

        Args:
            oid: The OID of the valueset

        Returns:
            Dict with valueset info {oid, name, title, version, status, code_count}

        Raises:
            VSACError: For any VSAC-related errors
        """
        valueset = self.download_valueset(oid)
        codes = self.extract_codes(valueset)

        return {
            "oid": oid,
            "name": valueset.get("name"),
            "title": valueset.get("title"),
            "version": valueset.get("version"),
            "status": valueset.get("status"),
            "code_count": len(codes)
        }

    def download_multiple(self, oids: Dict[str, str], force_refresh: bool = False,
                          continue_on_error: bool = True) -> Dict[str, List[Dict]]:
        """
        Download multiple valuesets at once.

        Args:
            oids: Dict mapping names to OIDs, e.g.,
                  {"encounter_inpatient": "2.16.840.1.113883.3.666.5.307"}
            force_refresh: If True, bypass cache and re-download
            continue_on_error: If True, continue downloading other valuesets on error

        Returns:
            Dict mapping names to code lists

        Raises:
            VSACError: If continue_on_error is False and any download fails
        """
        if not oids:
            return {}

        results = {}
        errors = {}

        self._log("=" * 60)
        self._log("VSAC Value Set Download")
        self._log("=" * 60)

        for name, oid in oids.items():
            self._log(f"\n[{name}]")
            self._log(f"OID: {oid}")

            try:
                codes = self.get_codes(oid, force_refresh)
                results[name] = codes

                if codes:
                    self._log(f"  Extracted {len(codes)} codes")
                    sample = codes[0]
                    self._log(f"  Sample: {sample['code']} - {sample.get('display', 'N/A')}")
                else:
                    self._log(f"  [WARNING] No codes extracted")

            except VSACError as e:
                errors[name] = str(e)
                self._log(f"  [ERROR] {e}")
                if not continue_on_error:
                    raise
                results[name] = []

        self._log("\n" + "=" * 60)
        self._log(f"Downloaded {len(results)} valuesets")
        if errors:
            self._log(f"Errors: {len(errors)}")
            for name, error in errors.items():
                self._log(f"  - {name}: {error}")
        self._log("=" * 60)

        return results

    def save_codes_summary(self, oids: Dict[str, str], output_file: str,
                           continue_on_error: bool = True):
        """
        Download valuesets and save a summary file.

        Args:
            oids: Dict mapping names to OIDs
            output_file: Path to save summary JSON
            continue_on_error: If True, continue on download errors

        Raises:
            OSError: If output file cannot be written
            VSACError: If continue_on_error is False and download fails
        """
        all_codes = self.download_multiple(oids, continue_on_error=continue_on_error)

        summary = {
            "total_valuesets": len(oids),
            "downloaded": sum(1 for codes in all_codes.values() if codes),
            "failed": sum(1 for codes in all_codes.values() if not codes),
            "statistics": self.get_statistics(),
            "valuesets": {}
        }

        for name, codes in all_codes.items():
            summary["valuesets"][name] = {
                "oid": oids.get(name),
                "code_count": len(codes),
                "sample_codes": codes[:3] if codes else [],
                "status": "success" if codes else "failed"
            }

        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(summary, f, indent=2)
            self._log(f"\nSummary saved to: {output_file}")
        except OSError as e:
            raise OSError(f"Failed to write summary file: {e}")

    def get_statistics(self) -> Dict:
        """Get download statistics"""
        return dict(self._stats)

    def clear_cache(self, oid: str = None):
        """
        Clear cached valuesets.

        Args:
            oid: Optional OID to clear. If None, clears all cache.
        """
        if oid:
            oid = self._validate_oid(oid)
            self.cache.pop(oid, None)
            cache_path = self._get_cache_path(oid)
            if cache_path and os.path.exists(cache_path):
                os.remove(cache_path)
        else:
            self.cache.clear()
            if self.cache_dir and os.path.exists(self.cache_dir):
                for filename in os.listdir(self.cache_dir):
                    if filename.endswith('.json'):
                        os.remove(os.path.join(self.cache_dir, filename))


# =============================================================================
# CQL PARSING UTILITIES
# =============================================================================

def extract_valuesets_from_cql(cql_content: str) -> Dict[str, str]:
    """
    Extract valueset OIDs from CQL file content.

    Args:
        cql_content: Content of a CQL file

    Returns:
        Dict mapping valueset names to OIDs

    Raises:
        VSACValidationError: If cql_content is invalid
    """
    if not cql_content or not isinstance(cql_content, str):
        raise VSACValidationError("CQL content must be a non-empty string")

    valuesets = {}

    for line_num, line in enumerate(cql_content.split('\n'), 1):
        line = line.strip()
        if not line.startswith('valueset'):
            continue

        try:
            # Parse: valueset "Name": 'http://cts.nlm.nih.gov/fhir/ValueSet/OID'
            # Extract name between quotes
            name_start = line.index('"') + 1
            name_end = line.index('"', name_start)
            name = line[name_start:name_end]

            # Extract OID from URL
            url_start = line.index("'") + 1
            url_end = line.index("'", url_start)
            url = line[url_start:url_end]

            # Extract OID from URL
            if '/ValueSet/' in url:
                oid = url.split('/ValueSet/')[-1]
                # Convert name to snake_case for dict key
                key = name.lower().replace(' ', '_').replace(',', '').replace('-', '_')
                valuesets[key] = oid
            else:
                logger.warning(f"Line {line_num}: Could not extract OID from URL: {url}")

        except (ValueError, IndexError) as e:
            logger.warning(f"Line {line_num}: Failed to parse valueset definition: {line[:50]}...")
            continue

    return valuesets


def extract_codesystems_from_cql(cql_content: str) -> Dict[str, str]:
    """
    Extract codesystem URLs from CQL file content.

    Args:
        cql_content: Content of a CQL file

    Returns:
        Dict mapping codesystem names to URLs

    Raises:
        VSACValidationError: If cql_content is invalid
    """
    if not cql_content or not isinstance(cql_content, str):
        raise VSACValidationError("CQL content must be a non-empty string")

    codesystems = {}

    for line_num, line in enumerate(cql_content.split('\n'), 1):
        line = line.strip()
        if not line.startswith('codesystem'):
            continue

        try:
            # Parse: codesystem "Name": 'URL'
            name_start = line.index('"') + 1
            name_end = line.index('"', name_start)
            name = line[name_start:name_end]

            url_start = line.index("'") + 1
            url_end = line.index("'", url_start)
            url = line[url_start:url_end]

            key = name.lower().replace(' ', '_').replace('-', '_')
            codesystems[key] = url

        except (ValueError, IndexError) as e:
            logger.warning(f"Line {line_num}: Failed to parse codesystem definition: {line[:50]}...")
            continue

    return codesystems


def extract_direct_codes_from_cql(cql_content: str) -> List[Dict]:
    """
    Extract direct code definitions from CQL file content.

    Args:
        cql_content: Content of a CQL file

    Returns:
        List of code dicts with name, code, system_name, display

    Raises:
        VSACValidationError: If cql_content is invalid
    """
    if not cql_content or not isinstance(cql_content, str):
        raise VSACValidationError("CQL content must be a non-empty string")

    codes = []

    for line_num, line in enumerate(cql_content.split('\n'), 1):
        line = line.strip()
        if not (line.startswith('code ') and ' from ' in line):
            continue

        try:
            # Parse: code "name": 'code' from "SystemName" display 'Display'
            # Extract code name
            name_start = line.index('"') + 1
            name_end = line.index('"', name_start)
            name = line[name_start:name_end]

            # Extract code value
            code_start = line.index("'") + 1
            code_end = line.index("'", code_start)
            code_value = line[code_start:code_end]

            # Extract system name
            from_idx = line.index(' from "')
            system_start = line.index('"', from_idx) + 1
            system_end = line.index('"', system_start)
            system_name = line[system_start:system_end]

            # Extract display (optional)
            display = None
            if " display '" in line:
                display_start = line.index(" display '") + len(" display '")
                display_end = line.index("'", display_start)
                display = line[display_start:display_end]

            codes.append({
                "name": name,
                "code": code_value,
                "system_name": system_name,
                "display": display
            })

        except (ValueError, IndexError) as e:
            logger.warning(f"Line {line_num}: Failed to parse code definition: {line[:50]}...")
            continue

    return codes
