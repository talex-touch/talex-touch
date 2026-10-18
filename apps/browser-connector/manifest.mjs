export const extensionManifest = {
  manifest_version: 3,
  name: '__MSG_appName__',
  description: '__MSG_appDescription__',
  version: '1.0.0',
  minimum_chrome_version: '124',
  default_locale: 'en',
  // Public SPKI, not a signing credential. Its hash fixes the unpacked extension ID.
  key: [
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApJZgVVILrKwdvK8mVPlx07s2',
    '5VB0j/Xs4NTuQOeiloQ1eRPYmT6nOF58Y04YIVevVx7Tfl8RTsD9iMAfuFpXwPlm',
    'i4JitH4w/RJFdcGxabUQoeAqyVZnymfxTRQ9snhQNIU66jy58DFCE8zpvNweUkK1B',
    '2DrPrtyL8EBgRfiKJCbephzkIs1WhUGkIqVnGLSyY0JTwR9sA8QF/pQL5qwiy2hH9',
    'vTc+0T4Lhv1N0y5oHMzDdMemBQoaRYk42l0isZ7UaWAp7tW6Kl/zK2hQqAxIpA5+',
    '4lHmxbElFNMoIq3DL1jBJfPzMMHbI+iO4QDHp14dA/3e3jj0QuFxW+tg7ZZQIDAQAB',
  ].join(''),
  permissions: ['nativeMessaging', 'alarms'],
  optional_permissions: ['bookmarks', 'tabs'],
  incognito: 'not_allowed',
  background: { service_worker: 'service-worker.js', type: 'module' },
  action: { default_popup: 'popup.html', default_title: '__MSG_appName__' },
  content_security_policy: { extension_pages: 'script-src \'self\'; object-src \'none\'; base-uri \'none\'' },
}
