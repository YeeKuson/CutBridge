import type {Project} from './model';

export type WorkbenchProject=Omit<Project,'history'>&{
  history:(Omit<Project['history'][number],'composition'>&{composition?:Project['composition']})[];
};

// The desk needs every version label, but snapshots only for visible feedback and proposals.
// Full snapshots remain on disk and available through MCP and project export.
export function workbenchView(project:Project):WorkbenchProject{
  const referenced=new Set([...project.feedback.map(n=>n.baseRevision),...project.proposals.map(p=>p.baseRevision)]);
  return {...project,history:project.history.map(({composition,...version})=>referenced.has(version.number)?{...version,composition}:version)};
}
