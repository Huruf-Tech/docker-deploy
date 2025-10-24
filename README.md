# Docker Deploy

> A powerful deployment tool for automating Docker-based application deployments to cloud instances like AWS EC2 and Google Cloud App Engine.

## Overview

Docker Deploy is a comprehensive deployment solution that streamlines the process of deploying APIs, websites, web applications, and other software to Linux or Windows-based cloud machines. It consists of two components: a server-side agent and a client-side CLI tool that work together to automate your deployment workflow.

## Features

- **Automatic Docker Installation**: Installs and configures Docker on your target machine
- **Secure Communication**: Password-protected deployment requests
- **Version Management**: Supports semantic versioning (major, minor, patch)
- **Environment Configuration**: Flexible environment and variable management
- **Deployment History**: Automatically stores deployment configurations for easy redeployment
- **Docker Hub Integration**: Seamless image building and registry push workflow

## Architecture

The tool operates in two parts:

1. **Server Agent**: Runs as a daemon on your deployment target, listening on port 3740 for deployment requests
2. **CLI Client**: A Deno-based command-line interface that orchestrates the build, push, and deployment process

## Installation

### Server-Side Setup

Install the Docker Deploy agent on your target machine (EC2, GCE, etc.):

```bash
git clone https://github.com/Huruf-Tech/docker-deploy.git && cd docker-deploy && chmod +x ./install.sh && ./install.sh
```

During installation, you'll be prompted to set a secure password for deployment authentication. Once complete, the agent daemon will start automatically and listen for incoming deployment requests on port 3740.

### Client-Side Setup

Install the Docker Deploy CLI using Deno:

```bash
deno install -Af --name docker-deploy --global jsr:@oridune/docker-deploy
```

**Prerequisites:**
- Deno runtime installed on your local machine
- Docker installed locally for building images
- Docker Hub account for image registry

## Usage

### First-Time Deployment

Navigate to your project directory and run:

```bash
docker-deploy
```

The CLI will guide you through an interactive setup process, asking for:

1. **Deployment Environment**: Choose from staging, development, or production
2. **Version Type**: Select major, minor, or patch for semantic versioning
3. **Docker Hub Organization**: Your Docker Hub organization name
4. **Image Name**: The name to assign to your Docker image
5. **Compose File Path**: Path to your docker-compose.yml file
6. **Environment Files**: Paths to environment variable files (comma-separated for multiple files)
7. **Machine Address**: IP address or DNS name of your EC2/cloud instance
8. **Authentication Password**: The password you set during server installation

All configuration details (except the password) are saved to `deployment-logs.json` in your project directory.

### Subsequent Deployments

On subsequent runs, the CLI will only prompt for:

- Deployment environment
- Version type
- Authentication password

All other settings will be loaded from `deployment-logs.json`, making redeployments quick and effortless.

## How It Works

### Client-Side Workflow

1. **Image Building**: The CLI uses your local Docker installation to build an image from your project's Dockerfile
2. **Registry Push**: The built image is pushed to Docker Hub under your specified organization and image name
3. **Deployment Request**: A POST request is sent to port 3740 of your target machine with:
   - `app`: Application name
   - `compose`: Docker Compose file contents
   - `env`: Environment variables (optional)

### Server-Side Workflow

1. **Request Authentication**: Validates the deployment request using the configured password
2. **Image Pull**: Pulls the specified image from Docker Hub
3. **Container Orchestration**: Uses Docker Compose to start your application with the provided configuration
4. **Service Management**: Manages container lifecycle and ensures your application is running

## API Reference

### Deployment Endpoint

The server agent exposes a single HTTP endpoint:

**POST** `http://<machine-address>:3740`

**Request Body:**
```json
{
  "app": "your-app-name",
  "compose": "docker-compose file contents",
  "env": "optional environment variables"
}
```

## Requirements

### Server Requirements
- Linux or Windows-based machine
- Internet connectivity
- Port 3740 accessible for incoming connections

### Client Requirements
- Deno runtime
- Docker installed locally
- Docker Hub account with push permissions
- Project with a valid Dockerfile

## Configuration Files

### deployment-logs.json

Automatically generated in your project directory, storing:
```json
{
  "name": "your app name",
  "development": {
    "version": {
      "major": 0,
      "minor": 0,
      "patch": 1
    },
    "dockerOrganization": "test",
    "dockerImage": "your project image name",
    "dockerCompose": "./deploy.docker-compose.yml", // A deployment specific compose file
    "envPaths": [ // You can pass multiple env file paths
      "./env/.env",
      "./env/.__environment__.env" // __environment__ will be replaced with your selected deployment environment.
    ],
    "agentUrls": [ // You can pass multiple hosts (for multi node deployment for vertical scaling)
      "http://<your host address (node 1)>:3740",
      "http://<your host address (node 2)>:3740"
    ]
  }
}

```

## Security Considerations

- The deployment password is never stored locally
- Always use strong passwords for production deployments
- Ensure port 3740 is properly secured with firewall rules
- Consider using SSH tunneling for additional security in production environments

## Troubleshooting

### Common Issues

**Connection Refused**
- Verify the server agent is running on the target machine
- Check that port 3740 is open in your firewall/security group

**Authentication Failed**
- Ensure you're using the correct password set during server installation

**Image Push Failed**
- Verify Docker Hub credentials are configured locally
- Check that your Docker Hub organization name is correct

**Build Failed**
- Ensure your project has a valid Dockerfile
- Verify all build dependencies are available

## Support

For issues, feature requests, or contributions, visit the [GitHub repository](https://github.com/Huruf-Tech/docker-deploy).

## License

Please refer to the LICENSE file in the repository for licensing information.