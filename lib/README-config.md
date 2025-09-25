# Folder Configuration Guide

This directory contains configuration files for the Audio Playlist Manager.

## Files

- `folder-config.ts` - Main configuration file for audio directories and playlist folder
- `google-drive.ts` - Google Drive API integration (imports config from folder-config.ts)

## Updating Folder Configuration

To update folder directories, edit `folder-config.ts`:

### 1. Switch Between Test and Production

The file contains both test and production configurations. To switch:

1. **For Production**: Uncomment the production section and comment out the test section
2. **For Test**: Keep the test section uncommented and production section commented

### 2. Add New Audio Directories

Add new entries to the `DEFAULT_AUDIO_DIRECTORIES` array:

```typescript
{
  name: "Your Directory Name",
  driveId: "your-google-drive-folder-id",
  localPath: "T:\\Your\\Local\\Path\\{audio_filename}",
}
```

### 3. Update Playlist Folder

Change the `PLAYLIST_FOLDER_ID` constant to your Google Drive playlist folder ID.

### 4. Configuration Validation

The file includes helper functions:

- `getConfigInfo()` - Get configuration metadata and status
- `validateConfig()` - Validate configuration for errors

### 5. Getting Google Drive Folder IDs

1. Open the folder in Google Drive
2. Copy the URL from your browser
3. Extract the folder ID from the URL (the long string after `/folders/`)
4. Example: `https://drive.google.com/drive/folders/1M4LWyru1Npx-hxdssgPZsQl8gCLNScBx`
   - Folder ID: `1M4LWyru1Npx-hxdssgPZsQl8gCLNScBx`

## Environment Variables

Make sure you have the following environment variable set:

```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
```

## Testing Configuration

After updating the configuration:

1. Restart the development server
2. Check the browser console for any configuration errors
3. Verify that folders load correctly in the application
