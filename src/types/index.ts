export interface StyleTemplate {
  id: string;
  name: string;
  description: string;
  sourceType: 'built-in' | 'user-generated';
  structureJson: Record<string, unknown>;
  formSchema: FormField[];
  coCreationPrompt: string;
  sampleSnippets: string;
  createdAt: number;
  updatedAt: number;
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date';
  required: boolean;
  options?: { label: string; value: string }[];
}

export interface UserArticle {
  id: string;
  title: string;
  sourceUrl: string;
  content: string;
  templateId: string | null;
  tags: string[];
  createdAt: number;
}

export interface AuditRecord {
  id: string;
  inputType: 'xiemi-link' | 'screenshot' | 'text';
  inputContent: string;
  resultJson: AuditResult;
  createdAt: number;
}

export interface AuditResult {
  issues: AuditIssue[];
}

export interface AuditIssue {
  dimension: 'text' | 'content' | 'compliance' | 'layout';
  severity: 'high' | 'medium' | 'low' | 'pass';
  location?: string;
  message: string;
  suggestion: string;
}

export interface GeneratedDraft {
  id: string;
  templateId: string;
  mode: 'quick' | 'co-creation' | 'generator-draft';
  paramsJson: Record<string, unknown>;
  contentHtml: string;
  contentText: string;
  createdAt: number;
}

export interface AppSettings {
  apiUrl: string;
  apiKey: string;
  modelName: string;
  brandColor: string;
  enabledAuditRules: string[];
  hasSeenWelcome: boolean;
  imapEmail?: string;
  imapAuthCode?: string;
  imapPollInterval?: number;
  licenseCode?: string;
  licenseFingerprint?: string;
  licenseToken?: string;
  licenseExpiresAt?: number;
}

export interface EmailMessage {
  id: string;
  uid: number;
  subject: string;
  sender: string;
  date: string;
  isRead: boolean;
  createdAt: number;
}

export interface ImapConfig {
  email: string;
  authCode: string;
  server: string;
  port: number;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  text: string;
  textLight: string;
  background: string;
  codeBg: string;
  codeColor: string;
  quoteBorder: string;
  quoteBg: string;
  border: string;
}

export interface ThemeStyle {
  [property: string]: string;
}

export interface Theme {
  name: string;
  description: string;
  colors: ThemeColors;
  typography: {
    fontFamily: string;
    fontSize: string;
    lineHeight: number;
  };
  styles: {
    [element: string]: ThemeStyle;
  };
}

export interface ThemeMeta {
  name: string;
  description: string;
}

export interface ImageGenerationResult {
  url: string;
  localPath: string;
  revisedPrompt?: string;
  createdAt: number;
}

export interface ImageGenerationOptions {
  prompt: string;
  size?: '512x512' | '768x768' | '720x1280' | '1280x720' | '1024x1024';
  responseFormat?: 'url' | 'b64_json';
}

export interface ImageGenerationResponse {
  created: number;
  data: Array<{
    url: string;
    revised_prompt?: string;
  }>;
}

export * from './article';
