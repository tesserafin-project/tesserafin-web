/**
 * Minimal, dependency-free JSON Schema validator.
 *
 * `tesserafin-design` intentionally avoids adding ajv (or any schema validation library) as a new
 * dependency (RFC-0005 W13.6 gate: "no new dependency without absolute necessity"). This module
 * implements just the subset of JSON Schema draft 2020-12 actually used by
 * `tesserafin-design/schema/theme.schema.json` and `tokens.schema.json`:
 *
 *   type, enum, pattern, minLength, minimum, maximum, properties, additionalProperties,
 *   required, minProperties, items, minItems, uniqueItems, $ref (to local "#/$defs/<name>").
 *
 * It is NOT a general-purpose JSON Schema implementation — no remote $ref, no allOf/anyOf/oneOf,
 * no $dynamicRef, no format keyword. If the two schema files above start using more of the spec,
 * extend this file accordingly rather than reaching for a dependency.
 */

/**
 * @param {object} schema Schema fragment (or the schema root).
 * @param {unknown} data Value to validate against `schema`.
 * @param {object} [schemaRoot] Root schema document, used to resolve `$ref`. Defaults to `schema`.
 * @param {string} [path] JSON-pointer-ish path used in error messages.
 * @returns {string[]} Human-readable validation errors; empty array means valid.
 */
export function validate(schema, data, schemaRoot = schema, path = '$') {
    if (schema.$ref) {
        return validate(
            resolveRef(schemaRoot, schema.$ref),
            data,
            schemaRoot,
            path
        );
    }

    const typeErrors = validateType(schema, data, path);
    if (typeErrors.length > 0) {
        // A type mismatch makes every other check meaningless (and often unsafe, e.g.
        // Object.keys() on a string) — stop here for this node.
        return typeErrors;
    }

    const errors = [
        ...validateEnum(schema, data, path),
        ...validateString(schema, data, path),
        ...validateNumber(schema, data, path)
    ];

    if (Array.isArray(data)) {
        errors.push(...validateArray(schema, data, schemaRoot, path));
    } else if (isPlainObject(data)) {
        errors.push(...validateObject(schema, data, schemaRoot, path));
    }

    return errors;
}

function validateType(schema, data, path) {
    if (!schema.type) return [];
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.some((type) => matchesType(data, type))) return [];
    return [
        `${path}: expected type "${types.join('|')}", got ${describeType(data)}`
    ];
}

function validateEnum(schema, data, path) {
    if (!schema.enum || schema.enum.includes(data)) return [];
    return [
        `${path}: value ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`
    ];
}

function validateString(schema, data, path) {
    if (typeof data !== 'string') return [];
    const errors = [];
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
        errors.push(
            `${path}: "${data}" does not match pattern ${schema.pattern}`
        );
    }
    if (schema.minLength !== undefined && data.length < schema.minLength) {
        errors.push(
            `${path}: length ${data.length} is below minLength ${schema.minLength}`
        );
    }
    return errors;
}

function validateNumber(schema, data, path) {
    if (typeof data !== 'number') return [];
    const errors = [];
    if (schema.minimum !== undefined && data < schema.minimum) {
        errors.push(`${path}: ${data} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
        errors.push(`${path}: ${data} is above maximum ${schema.maximum}`);
    }
    return errors;
}

function validateArray(schema, data, schemaRoot, path) {
    const errors = [];
    if (schema.minItems !== undefined && data.length < schema.minItems) {
        errors.push(
            `${path}: has ${data.length} items, below minItems ${schema.minItems}`
        );
    }
    if (
        schema.uniqueItems &&
        new Set(data.map((item) => JSON.stringify(item))).size !== data.length
    ) {
        errors.push(`${path}: items are not unique`);
    }
    if (schema.items) {
        data.forEach((item, index) => {
            errors.push(
                ...validate(schema.items, item, schemaRoot, `${path}[${index}]`)
            );
        });
    }
    return errors;
}

function validateObject(schema, data, schemaRoot, path) {
    const keys = Object.keys(data);
    const errors = [
        ...validateRequiredProperties(schema, data, keys, path),
        ...validateDeclaredProperties(schema, data, keys, schemaRoot, path)
    ];

    if (
        schema.minProperties !== undefined &&
        keys.length < schema.minProperties
    ) {
        errors.push(
            `${path}: has ${keys.length} properties, below minProperties ${schema.minProperties}`
        );
    }

    return errors;
}

function validateRequiredProperties(schema, data, _keys, path) {
    const errors = [];
    for (const requiredKey of schema.required ?? []) {
        if (!(requiredKey in data)) {
            errors.push(`${path}: missing required property "${requiredKey}"`);
        }
    }
    return errors;
}

function validateDeclaredProperties(schema, data, keys, schemaRoot, path) {
    const declaredProperties = schema.properties ?? {};
    const errors = [];
    for (const key of keys) {
        const propertySchema = declaredProperties[key];
        if (propertySchema) {
            errors.push(
                ...validate(
                    propertySchema,
                    data[key],
                    schemaRoot,
                    `${path}.${key}`
                )
            );
        } else if (schema.additionalProperties === false) {
            errors.push(`${path}: unexpected property "${key}"`);
        } else if (isSchemaLike(schema.additionalProperties)) {
            errors.push(
                ...validate(
                    schema.additionalProperties,
                    data[key],
                    schemaRoot,
                    `${path}.${key}`
                )
            );
        }
    }
    return errors;
}

/**
 * Convenience wrapper: throws a single Error (with every violation listed) instead of returning
 * an array. Used by the generator, which wants a hard failure with a clear message.
 *
 * @param {object} schema
 * @param {unknown} data
 * @param {string} label Human-readable label for the thing being validated (e.g. a file path).
 */
export function assertValid(schema, data, label) {
    const errors = validate(schema, data);
    if (errors.length > 0) {
        throw new Error(
            `${label} failed schema validation:\n${errors.map((error) => `  - ${error}`).join('\n')}`
        );
    }
}

function resolveRef(schemaRoot, ref) {
    if (!ref.startsWith('#/')) {
        throw new Error(
            `Unsupported $ref (only local "#/$defs/<name>" refs are supported): ${ref}`
        );
    }
    const segments = ref.slice(2).split('/');
    let node = schemaRoot;
    for (const segment of segments) {
        node = node?.[segment];
    }
    if (!node) {
        throw new Error(`Unresolvable $ref: ${ref}`);
    }
    return node;
}

function matchesType(data, type) {
    switch (type) {
        case 'object':
            return isPlainObject(data);
        case 'array':
            return Array.isArray(data);
        case 'string':
            return typeof data === 'string';
        case 'number':
            return typeof data === 'number' && Number.isFinite(data);
        case 'integer':
            return typeof data === 'number' && Number.isInteger(data);
        case 'boolean':
            return typeof data === 'boolean';
        case 'null':
            return data === null;
        default:
            return false;
    }
}

function describeType(data) {
    if (data === null) return 'null';
    if (Array.isArray(data)) return 'array';
    return typeof data;
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchemaLike(value) {
    return isPlainObject(value);
}
