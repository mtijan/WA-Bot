// Up to 50 import columns plus the standard contact aliases added at render time.
const MAX_VARIABLES = 64;
const MAX_VARIABLE_NAME_LENGTH = 64;
const MAX_VARIABLE_VALUE_LENGTH = 10_000;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const STANDARD_CONTACT_VARIABLES = [
  'Nama',
  'Phone Number',
  'Email',
  'Company',
  'Position',
  'Tags',
  'Notes'
];

export function normalizeVariableName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_VARIABLE_NAME_LENGTH);
}

export function canonicalVariableName(value) {
  return normalizeVariableName(value).toLocaleLowerCase('id-ID');
}

export function parseVariableJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return sanitizeVariableMap(value);
  }
  try {
    const parsed = JSON.parse(value);
    return sanitizeVariableMap(parsed);
  } catch {
    return {};
  }
}

export function sanitizeVariableMap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const output = Object.create(null);
  const seen = new Set();
  for (const [rawName, rawValue] of Object.entries(input)) {
    if (Object.keys(output).length >= MAX_VARIABLES) break;
    const name = normalizeVariableName(rawName);
    const canonicalName = canonicalVariableName(name);
    if (!name || RESERVED_KEYS.has(canonicalName) || seen.has(canonicalName)) continue;
    seen.add(canonicalName);
    output[name] = String(rawValue ?? '').slice(0, MAX_VARIABLE_VALUE_LENGTH);
  }
  return { ...output };
}

export function mergeVariableMaps(...inputs) {
  const merged = new Map();
  for (const input of inputs) {
    for (const [rawName, rawValue] of Object.entries(sanitizeVariableMap(input))) {
      const name = normalizeVariableName(rawName);
      merged.set(canonicalVariableName(name), [name, rawValue]);
    }
  }
  return Object.fromEntries([...merged.values()]);
}

export function contactToVariables(contact = {}) {
  const variables = Object.create(null);
  const seen = new Set();

  const add = (name, value) => {
    const normalizedName = normalizeVariableName(name);
    const canonicalName = canonicalVariableName(normalizedName);
    if (!normalizedName || RESERVED_KEYS.has(canonicalName) || seen.has(canonicalName)) return;
    seen.add(canonicalName);
    variables[normalizedName] = String(value ?? '').slice(0, MAX_VARIABLE_VALUE_LENGTH);
  };

  add('Nama', contact.name);
  add('Phone Number', contact.phone_number);
  add('Email', contact.email);
  add('Company', contact.company);
  add('Position', contact.position);
  add('Tags', contact.tags);
  add('Notes', contact.notes);

  const customFields = parseVariableJson(contact.custom_fields);
  for (const [name, value] of Object.entries(customFields)) add(name, value);

  return { ...variables };
}

export function renderCampaignMessage(template, inputVariables = {}) {
  const variables = sanitizeVariableMap(inputVariables);
  const lookup = new Map();
  for (const [name, value] of Object.entries(variables)) {
    lookup.set(canonicalVariableName(name), value);
  }

  const nameValue = lookup.get('nama') ?? lookup.get('name') ?? '';
  const phoneValue = lookup.get('phone number') ?? lookup.get('phone') ?? lookup.get('no') ?? '';
  lookup.set('nama', nameValue);
  lookup.set('name', nameValue);
  lookup.set('phone number', phoneValue);
  lookup.set('phone', phoneValue);
  lookup.set('no', phoneValue);
  const randomValue = String(Math.floor(100000 + (Math.random() * 900000)));
  lookup.set('random', randomValue);

  return String(template ?? '')
    .replace(/\{\{\s*([^{}|]+?)\s*\}\}/g, (token, rawName) => {
      const key = canonicalVariableName(rawName);
      return lookup.has(key) ? lookup.get(key) : token;
    })
    .replace(/\[\s*(name|nama)\s*\]/gi, nameValue)
    .replace(/\[\s*random\s*\]/gi, randomValue);
}
