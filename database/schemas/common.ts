export const stringId = {
  type: 'string',
  maxLength: 100,
} as const;

export const optionalString = {
  type: 'string',
  maxLength: 500,
} as const;

export const isoDate = {
  type: 'string',
  maxLength: 40,
} as const;
