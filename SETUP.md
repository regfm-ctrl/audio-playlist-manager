# Audio Playlist Manager - Setup Guide

This guide will help you set up the Audio Playlist Manager to work with your Google Drive.

## Prerequisites

- A Google account
- Access to Google Cloud Console
- Node.js and npm installed

## Step 1: Google Cloud Console Setup

1. **Go to Google Cloud Console**
   - Visit [console.cloud.google.com](https://console.cloud.google.com)
   - Sign in with your Google account

2. **Create or Select a Project**
   - Create a new project or select an existing one
   - Note the project name for reference

3. **Enable Google Drive API**
   - Go to "APIs & Services" → "Library"
   - Search for "Google Drive API"
   - Click on it and press "Enable"

4. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth 2.0 Client ID"
   - Choose "Web application" as the application type
   - Give it a name (e.g., "Audio Playlist Manager")

5. **Configure Authorized JavaScript Origins**
   Add these URLs to the "Authorized JavaScript origins" section:
   ```
   http://localhost:3000
   http://localhost:3001
   https://localhost:3000
   https://localhost:3001
   http://127.0.0.1:3000
   http://127.0.0.1:3001
   https://127.0.0.1:3000
   https://127.0.0.1:3001
   ```

6. **Get Your Client ID**
   - After creating the credentials, you'll see a popup with your Client ID
   - Copy the Client ID (it looks like: `123456789-abcdefg.apps.googleusercontent.com`)

## Step 2: Environment Configuration

1. **Create Environment File**
   - In your project root, create a file called `.env.local`
   - Add your Google Client ID:

   ```bash
   # .env.local
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id-here
   ```

2. **Restart the Development Server**
   ```bash
   npm run dev
   ```

## Step 3: Google Drive Folder Setup

1. **Create Audio Directories**
   - In Google Drive, create folders for your audio files:
     - IDs
     - CSAs - Audio
     - Promos - Audio
     - Sponsors - Audio
   - Or create any folders you prefer

2. **Create Playlist Folder**
   - Create a folder for your playlist files (.m3u8 files)
   - This is where the app will store and manage playlists

3. **Get Folder IDs**
   - Open each folder in Google Drive
   - Copy the URL from your browser
   - The folder ID is the long string after `/folders/` in the URL
   - Example: `https://drive.google.com/drive/folders/1ABC123DEF456` → ID is `1ABC123DEF456`

## Step 4: Configure the App

1. **Start the App**
   - Run `npm run dev`
   - Open [http://localhost:3000](http://localhost:3000)

2. **Complete Setup**
   - The app will show a setup guide if not configured
   - Follow the on-screen instructions
   - Configure your Google Drive folder IDs
   - Test the connection

## Step 5: Usage

Once configured, you can:
- Sign in with your Google account
- View and manage playlists
- Add audio files to playlists
- Create new playlists
- Edit playlist content

## Troubleshooting

### Common Issues

1. **"Failed to fetch files: 404"**
   - Check that your folder IDs are correct
   - Ensure the folders exist and are accessible
   - Verify your Google account has access to the folders

2. **"Authentication failed"**
   - Check that your Client ID is correct in `.env.local`
   - Verify the authorized origins in Google Cloud Console
   - Clear your browser cache and try again

3. **"Google Identity Services not loaded"**
   - Check your internet connection
   - Ensure the Google script is loading (check browser console)
   - Try refreshing the page

### Debug Mode

To enable detailed logging, add this to your `.env.local`:
```bash
NEXT_PUBLIC_DEBUG_MODE=true
```

### Getting Help

- Check the browser console for detailed error messages
- Verify all folder IDs are correct
- Ensure your Google account has proper permissions
- Try the setup process again from the beginning

## Security Notes

- Never commit your `.env.local` file to version control
- Keep your Google Client ID secure
- Regularly review your Google Cloud Console permissions
- Use HTTPS in production environments
