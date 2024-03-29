export type Arch = 'x64' | 'x86' | 'arm' | 'arm64'

export type OS = 'Win' | 'Darwin' | 'Linux' | 'Android' | 'iOS' | 'ipadOS' | 'web' | 'watchOS' | 'tvOS' | 'wearOS' | 'visionOS'

export enum DepartedOS {
  WINDOWS_8 = 'Windows 8',
  WINDOWS_7 = 'Windows 7',
  WINDOWS_VISTA = 'Windows Vista',
  WINDOWS_XP = 'Windows XP',
  WINDOWS_2000 = 'Windows 2000',
  WINDOWS_NT = 'Windows NT',
  WINDOWS_ME = 'Windows ME',
  WINDOWS_98 = 'Windows 98',
  WINDOWS_95 = 'Windows 95',
  WINDOWS_CE = 'Windows CE',
  WINDOWS_3_11 = 'Windows 3.11',

  MACOS_MOJAVE = 'macOS Mojave',
  MACOS_HIGH_SIERRA = 'macOS High Sierra',
  MACOS_SIERRA = 'macOS Sierra',
  MACOS_EL_CAPITAN = 'OS X El Capitan',
  MACOS_YOSEMITE = 'OS X Yosemite',
  MACOS_MAVERICKS = 'OS X Mavericks',
  MACOS_MOUNTAIN_LION = 'OS X Mountain Lion',
  MACOS_LION = 'Mac OS X Lion',
  MACOS_SNOW_LEOPARD = 'Mac OS X Snow Leopard',
  MACOS_LEOPARD = 'Mac OS X Leopard',
  MACOS_TIGER = 'Mac OS X Tiger',
  MACOS_PANTHER = 'Mac OS X Panther',
  MACOS_JAGUAR = 'Mac OS X Jaguar',
  MACOS_PUMA = 'Mac OS X Puma',
  MACOS_CHEETAH = 'Mac OS X Cheetah',

  LINUX_MANDRIVA = 'Linux Mandriva',
  LINUX_MINT = 'Linux Mint',
  LINUX_GENTOO = 'Linux Gentoo',
  LINUX_KNOPPIX = 'Linux Knoppix',
  LINUX_SLACKWARE = 'Linux Slackware',
  LINUX_XANDROS = 'Linux Xandros',
  LINUX_JOLI = 'Linux Joli',
  LINUX_SUSE = 'Linux SUSE',

  ANDROID_9 = 'Android 9',
  ANDROID_8_1 = 'Android 8.1',
  ANDROID_8 = 'Android 8',
  ANDROID_7_1 = 'Android 7.1',
  ANDROID_7 = 'Android 7',
  ANDROID_6 = 'Android 6',
  ANDROID_5_1 = 'Android 5.1',
  ANDROID_5 = 'Android 5',
  ANDROID_4_4 = 'Android 4.4',
  ANDROID_4_3 = 'Android 4.3',
  ANDROID_4_2 = 'Android 4.2',
  ANDROID_4_1 = 'Android 4.1',
  ANDROID_4 = 'Android 4',
  ANDROID_3_2 = 'Android 3.2',
  ANDROID_3_1 = 'Android 3.1',
  ANDROID_3 = 'Android 3',
  ANDROID_2_3 = 'Android 2.3',
  ANDROID_2_2 = 'Android 2.2',
  ANDROID_2_1 = 'Android 2.1',
  ANDROID_2 = 'Android 2',
  ANDROID_1_6 = 'Android 1.6',
  ANDROID_1_5 = 'Android 1.5',
  ANDROID_1_1 = 'Android 1.1',
  ANDROID_1_0 = 'Android 1.0',

  IOS_15 = 'iOS 15',
  IOS_14 = 'iOS 14',
  IOS_13 = 'iOS 13',
  IOS_12 = 'iOS 12',
  IOS_11 = 'iOS 11',
  IOS_10 = 'iOS 10',
  IOS_9 = 'iOS 9',
  IOS_8 = 'iOS 8',
  IOS_7 = 'iOS 7',
  IOS_6 = 'iOS 6',
  IOS_5 = 'iOS 5',

  IPADOS_15 = 'iPadOS 15',
  IPADOS_14 = 'iPadOS 14',
  IPADOS_13 = 'iPadOS 13',
  IPADOS_12 = 'iPadOS 12',
  IPADOS_11 = 'iPadOS 11',
  IPADOS_10 = 'iPadOS 10',
  IPADOS_9 = 'iPadOS 9',
  IPADOS_8 = 'iPadOS 8',
  IPADOS_7 = 'iPadOS 7',
  IPADOS_6 = 'iPadOS 6',
  IPADOS_5 = 'iPadOS 5',

  WEB_IE = 'Web IE',

  WATCHOS_8 = 'watchOS 8',
  WATCHOS_7 = 'watchOS 7',
  WATCHOS_6 = 'watchOS 6',
  WATCHOS_5 = 'watchOS 5',
  WATCHOS_4 = 'watchOS 4',
  WATCHOS_3 = 'watchOS 3',
  WATCHOS_2 = 'watchOS 2',
  WATCHOS_1 = 'watchOS 1',

  TVOS_15 = 'tvOS 15',
  TVOS_14 = 'tvOS 14',
  TVOS_13 = 'tvOS 13',
  TVOS_12 = 'tvOS 12',
  TVOS_11 = 'tvOS 11',
  TVOS_10 = 'tvOS 10',
  TVOS_9 = 'tvOS 9',
  TVOS_8 = 'tvOS 8',
  TVOS_7 = 'tvOS 7',
  TVOS_6 = 'tvOS 6',
  TVOS_5 = 'tvOS 5',
  TVOS_4 = 'tvOS 4',
  TVOS_3 = 'tvOS 3',
  TVOS_2 = 'tvOS 2',
  TVOS_1 = 'tvOS 1',

  WEAROS_3 = 'WearOS 3',
  WEAROS_2 = 'WearOS 2',
  WEAROS_1 = 'WearOS 1',
}

export enum SupportOS {
  WINDOWS = 'Windows',
  WINDOWS_11 = 'Windows 10 Pro',
  WINDOWS_10 = 'Windows 10',

  MACOS = 'macOS',
  MACOS_SONOMA = 'macOS Sonoma',
  MACOS_MONTEREY = 'macOS Monterey',
  MACOS_BIG_SUR = 'macOS Big Sur',

  LINUX = 'Linux',
  LINUX_UBUNTU = 'Linux Ubuntu',
  LINUX_DEBIAN = 'Linux Debian',
  LINUX_FEDORA = 'Linux Fedora',
  LINUX_RED_HAT = 'Linux Red Hat',
  LINUX_CENTOS = 'Linux CentOS',
  LINUX_CHROME_OS = 'Linux Chrome OS',
  LINUX_CHROMIUM_OS = 'Linux Chromium OS',

  ANDROID = 'Android',
  ANDROID_14 = 'Android 14',
  ANDROID_13 = 'Android 13',
  ANDROID_12 = 'Android 12',
  ANDROID_11 = 'Android 11',
  ANDROID_10 = 'Android 10',

  IOS = 'iOS',
  IOS_17 = 'iOS 17',
  IOS_16 = 'iOS 16',

  IPADOS = 'iPadOS',
  IPADOS_17 = 'iPadOS 17',
  IPADOS_16 = 'iPadOS 16',

  WEB = 'Web',
  WEB_CHROME = 'Web Chrome',
  WEB_FIREFOX = 'Web Firefox',
  WEB_SAFARI = 'Web Safari',
  WEB_EDGE = 'Web Edge',
  WEB_OPERA = 'Web Opera',
  WEB_ANDROID = 'Web Android',
  WEB_IOS = 'Web iOS',
  WEB_IPADOS = 'Web iPadOS',

  WATCHOS = 'watchOS',
  WATCHOS_9 = 'watchOS 10',
  WATCHOS_10 = 'watchOS 9',

  TVOS = 'tvOS',
  TVOS_17 = 'tvOS 17',
  TVOS_16 = 'tvOS 16',

  WEAROS = 'WearOS',
  WEAROS_4 = 'WearOS 4',

  VISIONOS = 'VisionOS',
  VISIONOS_1 = 'VisionOS 1',
}
