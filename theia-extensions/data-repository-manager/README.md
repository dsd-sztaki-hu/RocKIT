# Data Repository Manager

A Theia extension for managing remote data repository connections within the AROMA 2 platform.

## Overview

The Data Repository Manager provides a user interface for configuring and managing connections to external data repositories, primarily designed for ARP Dataverse instances. It allows users to add, edit, test, and remove repository configurations with secure API key storage.

## Features

- **Repository Management**: Add, edit, and delete data repository configurations
- **Connection Testing**: Validate repository URLs and API tokens before saving
- **Secure Storage**: API keys are stored securely using the system's credential manager
- **Search & Filter**: Quickly find repositories using the built-in search functionality
- **Bulk Operations**: Select and manage multiple repositories at once

## Prerequisites

- Node.js 18.x or higher
- Yarn 4.x
- AROMA 2 project environment

## Installation

This extension is part of the AROMA 2 monorepo. To build and run:

```bash
# Install dependencies
yarn install

# Build the extension
yarn build

# Start the application
yarn start
```

## Usage

1. Open the Data Repository Manager panel from the application menu or sidebar
2. Click **Add Repository** to create a new configuration
3. Fill in the required fields:
   - **Title**: A descriptive name for the repository
   - **Base URL**: The repository's API endpoint URL
   - **API Token**: Authentication token for the repository
4. Click **Test Connection** to verify the configuration
5. Click **Save** to store the repository configuration

To edit or delete a repository, select it from the table and use the corresponding action buttons.

## Configuration

Repository configurations are stored in:
- **Non-sensitive data**: JSON file in the user's configuration directory
- **API keys**: Secure system credential manager (Keytar)

## Development

```bash
# Watch mode for development
yarn watch

# Run tests
yarn test
```

## License

Part of the AROMA 2 project.
