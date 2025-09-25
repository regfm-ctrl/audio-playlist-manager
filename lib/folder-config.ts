// Audio Playlist Manager - Folder Configuration
// This file contains all folder directory configurations for easy updates

import type { AudioDirectory } from "./google-drive"















// Production directories (uncomment when ready for production)
// export const DEFAULT_AUDIO_DIRECTORIES: AudioDirectory[] = [
//   {
//     name: "CSAs - Audio",
//     driveId: "1CrQC5MBpF_ryPAvz8EaPmBTnp1mctW_B",
//     localPath: "T:\\REGFM RadioBOSS\\CSAs Audio\\{audio_filename}",
//   },
//   {
//     name: "Promos - Audio",
//     driveId: "1mbx5urrrdPcRF27rDNm88yqZaPtQ9v9d",
//     localPath: "T:\\REGFM RadioBOSS\\Promos\\{audio_filename}",
//   },
//   {
//     name: "Sponsors - Audio",
//     driveId: "1hidm0iLokkG92VN_PMxcm56FikqJOahl",
//     localPath: "T:\\REGFM RadioBOSS\\Sponsors\\{audio_filename}",
//   },
// ]

// Production playlist folder (uncomment when ready for production)
// export const PLAYLIST_FOLDER_ID = "1M4LWyru1Npx-hxdssgPZsQl8gCLNScBx"







// Test directories (current active configuration)
export const DEFAULT_AUDIO_DIRECTORIES: AudioDirectory[] = [
  {
    name: "IDs-",
    driveId: "1cy56CgC1KtxCgZI-kGOEWTTNuC5rjzh_",
    localPath: "T:\\REGFM RadioBOSS\\IDs\\{audio_filename}",
  },
  {
    name: "CSAs - Audio",
    driveId: "14Oy00clKujI6ldWv7NW35DybZVBN_MPm",
    localPath: "T:\\REGFM RadioBOSS\\CSAs Audio\\{audio_filename}",
  },
  {
    name: "Promos - Audio",
    driveId: "1PzkL-eDZVPU-g3D7c5IUY93g14-SV3l6",
    localPath: "T:\\REGFM RadioBOSS\\Promos\\{audio_filename}",
  },
  {
    name: "Sponsors - Audio",
    driveId: "1B_LOIo2jl_-P-1UrWoRZ4W688_lk0NQC",
    localPath: "T:\\REGFM RadioBOSS\\Sponsors\\{audio_filename}",
  },
]

// Test playlist folder (current active configuration)
export const PLAYLIST_FOLDER_ID = "1sPxn5mFxy7DagMtpmGGq4-K1c98BX_-b"


























// Configuration metadata
export const CONFIG_INFO = {
  version: "1.0.0",
  lastUpdated: "2025-09-25",
  environment: "test", // Change to "production" when switching to production configs
  description: "Audio Playlist Manager folder configuration"
} as const

// Helper function to get configuration info
export function getConfigInfo() {
  return {
    ...CONFIG_INFO,
    totalDirectories: DEFAULT_AUDIO_DIRECTORIES.length,
    configuredDirectories: DEFAULT_AUDIO_DIRECTORIES.filter(d => d.driveId).length,
    playlistFolderConfigured: !!PLAYLIST_FOLDER_ID
  }
}

// Helper function to validate configuration
export function validateConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = []
  
  if (!PLAYLIST_FOLDER_ID) {
    errors.push("Playlist folder ID is not configured")
  }
  
  const unconfiguredDirs = DEFAULT_AUDIO_DIRECTORIES.filter(d => !d.driveId)
  if (unconfiguredDirs.length > 0) {
    errors.push(`Unconfigured directories: ${unconfiguredDirs.map(d => d.name).join(", ")}`)
  }
  
  const duplicateNames = DEFAULT_AUDIO_DIRECTORIES
    .map(d => d.name)
    .filter((name, index, arr) => arr.indexOf(name) !== index)
  
  if (duplicateNames.length > 0) {
    errors.push(`Duplicate directory names: ${duplicateNames.join(", ")}`)
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}
