import { sendError } from './http_response.js';

/**
 * Validates request data against specified rules.
 * Rules object format:
 * {
 *   fieldName: {
 *     required: boolean,
 *     type: 'string' | 'number' | 'boolean' | 'array' | 'object',
 *     min: number, // minimum length for string/array, minimum value for number
 *     max: number, // maximum length for string/array, maximum value for number
 *     allowedValues: any[], // enum values
 *     matches: RegExp,
 *     custom: (value) => string | null // returns custom error message or null
 *   }
 * }
 * Returns null if valid, or a details object of errors if invalid.
 */
export function validate(data, rules) {
  const errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const val = data?.[field];

    if (rule.required && (val === undefined || val === null || val === '')) {
      errors[field] = `${field} wajib diisi.`;
      continue;
    }

    if (val !== undefined && val !== null && val !== '') {
      if (rule.type) {
        if (rule.type === 'array') {
          if (!Array.isArray(val)) {
            errors[field] = `${field} harus berupa array.`;
            continue;
          }
        } else if (rule.type === 'number') {
          const num = Number(val);
          if (Number.isNaN(num)) {
            errors[field] = `${field} harus berupa angka.`;
            continue;
          }
        } else if (typeof val !== rule.type) {
          errors[field] = `${field} harus berupa ${rule.type}.`;
          continue;
        }
      }

      if (rule.min !== undefined) {
        if (typeof val === 'string' && val.length < rule.min) {
          errors[field] = `${field} minimal ${rule.min} karakter.`;
        } else if (typeof val === 'number' && val < rule.min) {
          errors[field] = `${field} minimal bernilai ${rule.min}.`;
        } else if (Array.isArray(val) && val.length < rule.min) {
          errors[field] = `${field} minimal berisi ${rule.min} item.`;
        }
      }

      if (rule.max !== undefined) {
        if (typeof val === 'string' && val.length > rule.max) {
          errors[field] = `${field} maksimal ${rule.max} karakter.`;
        } else if (typeof val === 'number' && val > rule.max) {
          errors[field] = `${field} maksimal bernilai ${rule.max}.`;
        } else if (Array.isArray(val) && val.length > rule.max) {
          errors[field] = `${field} maksimal berisi ${rule.max} item.`;
        }
      }

      if (rule.allowedValues && !rule.allowedValues.includes(val)) {
        errors[field] = `${field} bernilai tidak valid. Harus salah satu dari: ${rule.allowedValues.join(', ')}.`;
      }

      if (rule.matches && !rule.matches.test(String(val))) {
        errors[field] = `${field} format tidak sesuai.`;
      }

      if (rule.custom) {
        const customError = rule.custom(val);
        if (customError) {
          errors[field] = customError;
        }
      }
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Express middleware helper for body validation
 */
export function validateBody(rules) {
  return (req, res, next) => {
    const errors = validate(req.body, rules);
    if (errors) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Payload permintaan tidak valid.', errors);
    }
    next();
  };
}
