export const RECORDING_TEST_EMAIL = 'khrystynaklochko@gmail.com';

export function isRecordingTestUser(email?: string | null) {
  return (email ?? '').trim().toLowerCase() === RECORDING_TEST_EMAIL;
}
