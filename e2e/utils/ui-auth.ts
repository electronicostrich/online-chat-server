// Helpers for browser-driven authentication used by UI specs (AC-UI-*).
// API-driven specs (AC-AUTH-*, AC-MSG-*, etc.) keep using `e2e/utils/auth.ts`
// since they don't need a real React app to be mounted.
import type { APIRequestContext, Page } from '@playwright/test';
import { request as apiRequest } from '@playwright/test';

export interface SeededUser {
  username: string;
  email: string;
  password: string;
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newSeededUser(role: string): SeededUser {
  const suffix = uniqueSuffix();
  return {
    username: `${role}_${suffix}`.replace(/-/g, '_'),
    email: `${role}-${suffix}@example.com`,
    password: 'StrongPassword123!',
  };
}

export async function seedTruncateAndCreate(
  api: APIRequestContext,
  users: SeededUser[],
): Promise<void> {
  const res = await api.post('/__test/seed', {
    data: { strategy: 'truncate', users },
  });
  if (res.status() !== 200) {
    throw new Error(`/__test/seed failed: status=${res.status().toString()}`);
  }
}

export async function withApiContext<T>(
  fn: (api: APIRequestContext) => Promise<T>,
): Promise<T> {
  const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
  try {
    return await fn(api);
  } finally {
    await api.dispose();
  }
}

// Drive the UI login flow end-to-end. Asserts that the AppShell is rendered
// after a successful sign-in.
export async function signInViaUi(page: Page, user: SeededUser): Promise<void> {
  await page.goto('/');
  await page.getByTestId('login-screen').waitFor({ state: 'visible' });
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('app-shell').waitFor({ state: 'visible' });
}

// Create a room from the side-nav and wait for it to be selected.
export async function createRoomViaUi(page: Page, name: string): Promise<string> {
  await page.getByTestId('create-room-name').fill(name);
  await page.getByTestId('create-room-submit').click();
  const item = page.getByTestId('room-list-item').filter({ hasText: name });
  await item.waitFor({ state: 'visible' });
  await page.getByTestId('chat-view').waitFor({ state: 'visible' });
  const chatId = await page
    .getByTestId('chat-view')
    .getAttribute('data-chat-id');
  if (chatId === null) throw new Error('chat-view is missing data-chat-id');
  return chatId;
}
