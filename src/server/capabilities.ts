import {PROJECT_FORMAT_VERSION} from './project-file';
export const API_VERSION=2;
export const APP_VERSION='0.2.6';
export const capabilities={
  apiVersion:API_VERSION,projectFormatVersion:PROJECT_FORMAT_VERSION,
  features:['folder-discovery','root-project-file','review-proposals','feedback-images','voice-review','feedback-change-scope','dialogue-suggestion-drafts','background-service','session-ownership','atomic-feedback-batches','review-history-removal','confirmed-human-edits'],
  verifiedPlatforms:['win32'],
  platformValidation:{win32:'primary-workbench-and-media',linux:'ubuntu-wsl2-core-http-mcp-render-tested',darwin:'adapters-only-not-device-tested'},
  sessionRelay:{codex:'request-thread-metadata-with-environment-fallback',claude:'native-channel-requires-host-approval',other:'manual-continuation'},
};
