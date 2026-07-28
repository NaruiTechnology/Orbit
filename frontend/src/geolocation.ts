import catalog from "../../shared/geolocation.json";

export interface GeolocationSite {
  id: string;
  value: string;
  name: string;
  name_zh: string;
  label_key: string;
}

export interface GeolocationCatalog {
  version: number;
  default_site: string;
  sites: readonly GeolocationSite[];
  legacy_aliases: Readonly<Record<string, string>>;
}

export const GEOLOCATION_CATALOG = catalog as GeolocationCatalog;
export const GEOLOCATION_SITES = GEOLOCATION_CATALOG.sites;
export const DEFAULT_SITE = GEOLOCATION_CATALOG.default_site;

export function normalizeSite(value: unknown): string {
  const site = String(value ?? "").trim();
  const canonical = GEOLOCATION_CATALOG.legacy_aliases[site] ?? site;
  return GEOLOCATION_SITES.some((option) => option.value === canonical)
    ? canonical
    : DEFAULT_SITE;
}

export function geolocationSite(value: unknown): GeolocationSite | undefined {
  const canonical = normalizeSite(value);
  return GEOLOCATION_SITES.find((option) => option.value === canonical);
}
