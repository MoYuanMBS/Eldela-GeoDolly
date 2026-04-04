"""Nominatim search placeholder."""

import httpx

nomatinat_url = "https://nominatim.openstreetmap.org/search"
location_limit = 30


def search_location(query, country_codes=""):
    """Search for a location using Nominatim."""
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": location_limit,
        "addressdetails": 1,
        "polygon_geojson": 1,
    }

    if country_codes:
        params["countrycodes"] = country_codes

    headers = {
        "User-Agent": "geomcp/test",
    }

    try:
        response = httpx.get(nomatinat_url, params=params, headers=headers, timeout=30.0)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as error:
        print(f"HTTP error occurred: {error}")
        return []


if __name__ == "__main__":
    test_location = "China Impression Restaurant"
    test_country_codes = "ca"
    results = search_location(test_location, test_country_codes)
    print(results)
