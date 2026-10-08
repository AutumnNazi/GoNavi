/**
 * 模拟数据工作台的前端模型。字段与后端 internal/mockdata 的 JSON 一一对应；
 * 数值和日期一律用字符串传递，避免 number 精度与时区换算。
 */

export type MockDataKind =
  | 'null' | 'fixed' | 'sequence' | 'int_range' | 'decimal_range' | 'random_string' | 'text' | 'list'
  | 'enum' | 'boolean' | 'bits' | 'uuid' | 'date_range' | 'time_range' | 'datetime_range'
  | 'datetime_sequence' | 'reference' | 'json' | 'person_name' | 'username' | 'email' | 'phone'
  | 'province' | 'city' | 'address' | 'company' | 'url' | 'ipv4';

export type MockDataCategory =
  | 'integer' | 'decimal' | 'float' | 'string' | 'text' | 'boolean' | 'date' | 'time' | 'datetime'
  | 'year' | 'uuid' | 'json' | 'enum' | 'set' | 'bit' | 'inet' | 'binary' | 'unsupported';

export type MockDataLocale = 'zh' | 'en';

export type MockDataGenerator = {
  kind: MockDataKind;
  value?: string;
  values?: string[];
  min?: string;
  max?: string;
  start?: string;
  step?: string;
  prefix?: string;
  width?: number;
  scale?: number;
  minLength?: number;
  maxLength?: number;
  charset?: string;
  ratio?: number;
  locale?: MockDataLocale;
  compact?: boolean;
};

export type MockDataColumnPlan = {
  name: string;
  skip: boolean;
  nullRatio?: number;
  generator: MockDataGenerator;
};

export type MockDataPlan = {
  rowCount: number;
  seed: number;
  locale: MockDataLocale;
  columns: MockDataColumnPlan[];
};

export type MockDataProfile = {
  name: string;
  type: string;
  comment?: string;
  category: MockDataCategory;
  nullable: boolean;
  hasDefault: boolean;
  autoIncrement: boolean;
  computed: boolean;
  primaryKey: boolean;
  unique: boolean;
  maxLength?: number;
  lengthInBytes?: boolean;
  asciiOnly?: boolean;
  precision?: number;
  scale?: number;
  min?: string;
  max?: string;
  enumValues?: string[];
  foreignKey?: { table: string; column: string };
  nextValue?: string;
};

export type MockDataColumnInfo = {
  profile: MockDataProfile;
  allowedKinds: MockDataKind[];
  required: boolean;
  referenceCount: number;
};

export type MockDataInspection = {
  dbType: string;
  family: string;
  columns: MockDataColumnInfo[];
  plans: MockDataColumnPlan[];
  maxRowCount: number;
};

export type MockDataPreviewResult = {
  columns: string[];
  rows: Array<Record<string, string | null>>;
};

export type MockDataRunResult = {
  total: number;
  success: number;
  failed: number;
  errorLogs?: string[];
  stoppedOnError?: boolean;
  outcomeUnknown?: boolean;
  cancelled?: boolean;
  durationMs: number;
};

export type MockDataProgress = {
  jobId?: string;
  current: number;
  total?: number;
  success: number;
  errors: number;
};

export type MockDataParamKey =
  | 'value' | 'values' | 'enumValues' | 'range' | 'scale' | 'sequence' | 'prefix' | 'length' | 'charset'
  | 'ratio' | 'locale' | 'compact' | 'datetimeSequence';

/** 每种规则在参数区显示哪些输入。 */
export const MOCK_DATA_KIND_PARAMS: Record<MockDataKind, MockDataParamKey[]> = {
  null: [],
  fixed: ['value'],
  list: ['values'],
  enum: ['enumValues'],
  sequence: ['sequence', 'prefix'],
  int_range: ['range'],
  decimal_range: ['range', 'scale'],
  random_string: ['length', 'charset'],
  text: ['length', 'locale'],
  boolean: ['ratio'],
  bits: [],
  uuid: ['compact'],
  date_range: ['range'],
  time_range: ['range'],
  datetime_range: ['range'],
  datetime_sequence: ['datetimeSequence'],
  reference: [],
  json: ['locale'],
  person_name: ['locale'],
  username: [],
  email: [],
  phone: ['locale'],
  province: ['locale'],
  city: ['locale'],
  address: ['locale'],
  company: ['locale'],
  url: [],
  ipv4: [],
};

export const MOCK_DATA_CHARSETS = ['alnum', 'alpha', 'lower', 'upper', 'upper_digits', 'digits', 'hex', 'chinese'] as const;

export const MOCK_DATA_DEFAULT_ROW_COUNT = 100;
export const MOCK_DATA_PROGRESS_EVENT = 'mockdata:progress';

/** 随机种子取 32 位以内的正整数，前端 number 与后端 int64 都能精确表示。 */
export const createMockDataSeed = (): number => Math.floor(Math.random() * 2_147_483_647) + 1;

export const createMockDataJobId = (): string => `mockdata-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const resolveMockDataLocale = (language: string | undefined): MockDataLocale => (
  String(language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
);

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const formatMockDataDate = (date: Date): string => (
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
);

export const formatMockDataDateTime = (date: Date): string => (
  `${formatMockDataDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
);

const clampNumberText = (value: number, min: string | undefined, max: string | undefined): string => {
  let result = value;
  const low = Number(min);
  const high = Number(max);
  if (min !== undefined && min !== '' && Number.isFinite(low)) result = Math.max(result, low);
  if (max !== undefined && max !== '' && Number.isFinite(high)) result = Math.min(result, high);
  return String(result);
};

/** 列最多能放多少个字符；中文在按字节计的列里按 UTF-8 三字节算，0 表示不限。与后端 lengthCapacity 一致。 */
export const resolveMockDataCapacity = (profile: MockDataProfile, wide: boolean): number => {
  const maxLength = profile.maxLength || 0;
  if (maxLength <= 0) return 0;
  return profile.lengthInBytes && wide ? Math.floor(maxLength / 3) : maxLength;
};

const fitCapacity = (length: number, capacity: number): number => (
  capacity > 0 ? Math.max(Math.min(length, capacity), 1) : length
);

/** 规则的默认参数：切换规则且后端没有给出同种推荐时使用，保证切过去就能预览。 */
export const buildDefaultMockDataGenerator = (
  kind: MockDataKind,
  profile: MockDataProfile,
  locale: MockDataLocale,
  now: Date = new Date(),
): MockDataGenerator => {
  const lastYear = new Date(now.getTime());
  lastYear.setFullYear(now.getFullYear() - 1);
  const capacity = resolveMockDataCapacity(profile, locale === 'zh' && !profile.asciiOnly);
  switch (kind) {
    case 'sequence':
      return { kind, start: profile.nextValue || '1', step: '1' };
    case 'int_range':
      return { kind, min: clampNumberText(1, profile.min, profile.max), max: clampNumberText(1000, profile.min, profile.max) };
    case 'decimal_range':
      return { kind, min: clampNumberText(0, profile.min, profile.max), max: clampNumberText(1000, profile.min, profile.max), scale: profile.scale || 2 };
    case 'random_string': {
      // 随机串默认是字母数字，每个字符一个字节，不按中文三字节折算。
      const asciiCapacity = resolveMockDataCapacity(profile, false);
      return { kind, charset: 'alnum', minLength: fitCapacity(8, asciiCapacity), maxLength: fitCapacity(16, asciiCapacity) };
    }
    case 'text':
      return { kind, locale, minLength: fitCapacity(10, capacity), maxLength: fitCapacity(40, capacity) };
    case 'boolean':
      return { kind, ratio: 0.5 };
    case 'date_range':
      return { kind, min: formatMockDataDate(lastYear), max: formatMockDataDate(now) };
    case 'time_range':
      return { kind, min: '08:00:00', max: '20:00:00' };
    case 'datetime_range':
      return { kind, min: formatMockDataDateTime(lastYear), max: formatMockDataDateTime(now) };
    case 'datetime_sequence':
      return { kind, start: formatMockDataDateTime(new Date(now.getTime() - 30 * 24 * 3600 * 1000)), step: '1' };
    case 'list':
      return { kind, values: [] };
    case 'fixed':
      return { kind, value: '' };
  }
  return MOCK_DATA_KIND_PARAMS[kind].includes('locale') ? { kind, locale } : { kind };
};

/** 换规则：后端推荐的正好是这种规则就用推荐参数，否则用默认参数。 */
export const switchMockDataGeneratorKind = (
  kind: MockDataKind,
  profile: MockDataProfile,
  locale: MockDataLocale,
  suggested: MockDataGenerator | undefined,
): MockDataGenerator => (
  suggested?.kind === kind ? { ...suggested } : buildDefaultMockDataGenerator(kind, profile, locale)
);

export const isMockDataColumnSkippable = (column: MockDataColumnInfo): boolean => (
  !column.required && !column.profile.computed
);
