import { getDb } from '@/hooks/useDb';
import type { AppSettings } from '@/types';

const DEFAULT_SETTINGS: AppSettings = {
  apiUrl: 'https://chat.ecnu.edu.cn/open/api/v1/chat/completions',
  apiKey: '',
  modelName: 'ecnu-max',
  brandColor: '#8B1A1A',
  enabledAuditRules: [
    'typo',
    'punctuation',
    'sensitive_words',
    'notification_completeness',
    'date_consistency',
    'logic_conflict',
    'copyright_image',
    'portrait_rights',
    'political_risk',
    'paragraph_length',
    'image_alt',
    'structure_clarity',
  ],
  hasSeenWelcome: false,
  imapEmail: '',
  imapAuthCode: '',
  imapPollInterval: 5,
};

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    'SELECT key, value FROM settings'
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));

  let enabledAuditRules = DEFAULT_SETTINGS.enabledAuditRules;
  const rawRules = map.get('enabledAuditRules');
  if (rawRules) {
    try {
      const parsed = JSON.parse(rawRules);
      if (Array.isArray(parsed)) {
        enabledAuditRules = parsed;
      }
    } catch {
      // ignore parse error, use default
    }
  }

  const imapPollIntervalRaw = map.get('imapPollInterval');
  const imapPollInterval = imapPollIntervalRaw ? parseInt(imapPollIntervalRaw, 10) : DEFAULT_SETTINGS.imapPollInterval;

  return {
    apiUrl: map.get('apiUrl') ?? DEFAULT_SETTINGS.apiUrl,
    apiKey: map.get('apiKey') ?? DEFAULT_SETTINGS.apiKey,
    modelName: map.get('modelName') ?? DEFAULT_SETTINGS.modelName,
    brandColor: map.get('brandColor') ?? DEFAULT_SETTINGS.brandColor,
    enabledAuditRules,
    hasSeenWelcome: map.get('hasSeenWelcome') === 'true',
    imapEmail: map.get('imapEmail') ?? DEFAULT_SETTINGS.imapEmail,
    imapAuthCode: map.get('imapAuthCode') ?? DEFAULT_SETTINGS.imapAuthCode,
    imapPollInterval: Number.isNaN(imapPollInterval) ? DEFAULT_SETTINGS.imapPollInterval : imapPollInterval,
    licenseCode: map.get('license.code') ?? undefined,
    licenseFingerprint: map.get('license.fingerprint') ?? undefined,
    licenseToken: map.get('license.token') ?? undefined,
    licenseExpiresAt: map.get('license.expires_at')
      ? parseInt(map.get('license.expires_at')!, 10)
      : undefined,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  const entries = [
    ['apiUrl', settings.apiUrl],
    ['apiKey', settings.apiKey],
    ['modelName', settings.modelName],
    ['brandColor', settings.brandColor],
    ['enabledAuditRules', JSON.stringify(settings.enabledAuditRules)],
    ['hasSeenWelcome', settings.hasSeenWelcome ? 'true' : 'false'],
    ['imapEmail', settings.imapEmail ?? ''],
    ['imapAuthCode', settings.imapAuthCode ?? ''],
    ['imapPollInterval', String(settings.imapPollInterval ?? 5)],
    ['license.code', settings.licenseCode ?? ''],
    ['license.fingerprint', settings.licenseFingerprint ?? ''],
    ['license.token', settings.licenseToken ?? ''],
    ['license.expires_at', settings.licenseExpiresAt ? String(settings.licenseExpiresAt) : ''],
  ];
  for (const [key, value] of entries) {
    await db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, value]
    );
  }
}
