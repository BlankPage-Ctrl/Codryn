export type SettingsField = 'key' | 'value' | 'created_at' | 'updated_at';

export type SortDirection = 'asc' | 'desc';

export interface SettingsSort {
  field: SettingsField;
  direction: SortDirection;
}

// String operators (apply to key / value)
export type StringLeafOp =
  | { $eq: string }
  | { $ne: string }
  | { $contains: string }
  | { $startsWith: string }
  | { $endsWith: string }
  | { $wildcard: string }
  | { $in: string[] }
  | { $nin: string[] }
  // length filter on the field string length
  | { $length: LengthFilter };

// Range operators (apply to created_at / updated_at, or value with asNumber)
export type RangeLeafOp =
  | { $gt: string | number }
  | { $gte: string | number }
  | { $lt: string | number }
  | { $lte: string | number }
  | { $between: [string | number, string | number] }
  | { $eq: string | number }
  | { $ne: string | number };

export interface LengthFilter {
  $eq?: number;
  $ne?: number;
  $gt?: number;
  $gte?: number;
  $lt?: number;
  $lte?: number;
  $between?: [number, number];
}

export type LeafCondition =
  | {
      field: SettingsField;
      op: StringLeafOp | RangeLeafOp;
      caseInsensitive?: boolean;
      asNumber?: boolean;
    }
  | { field: SettingsField; $eq: string | number }
  | { field: SettingsField; $ne: string | number };

export type Condition =
  | LeafCondition
  | { $and: Condition[] }
  | { $or: Condition[] }
  | { $not: Condition };

export interface SettingsQuery {
  where?: Condition;
  sort?: SettingsSort[];
  limit?: number;
  offset?: number;
}

export interface SettingsQueryResult {
  query: SettingsQuery;
  sql: string;
  params: unknown[];
}
