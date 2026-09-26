#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createApp } from './app.js';

const app = createApp();
const server = new Server({ name: 'redhanded-guard', version: '0.1.0' }, { capabilities: { tools: {} } });
const tools = [
  tool('start_run', 'Start a guarded run for one eligible GitHub issue or structured raw report.', { issue: { type: ['integer', 'string'] }, raw_report: { type: 'object' }, evidence_mode: { enum: ['tests-only', 'visual'] }, trueforge_session_id: { type: 'string' } }),
  tool('submit_reproduction', 'Submit a structured reproduction for trusted baseline execution.', { run_id: { type: 'string' }, proposal: { type: 'object' } }, ['run_id', 'proposal']),
  tool('submit_patch', 'Submit a unified patch after a trusted red reproduction.', { run_id: { type: 'string' }, patch: { type: 'string' } }, ['run_id', 'patch']),
  tool('verify_run', 'Verify the frozen reproduction and exact candidate in fresh sandboxes.', { run_id: { type: 'string' } }, ['run_id']),
  tool('request_publication_approval', 'Bind optional approval to the verified run, candidate, and evidence.', { run_id: { type: 'string' } }, ['run_id']),
  tool('publish_verified_pr', 'Publish the stored verified candidate as a branch and pull request. This tool cannot merge.', { run_id: { type: 'string' } }, ['run_id']),
  tool('get_run', 'Read a trusted run record.', { run_id: { type: 'string' } }, ['run_id'])
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const a = params.arguments || {}; let result;
  if (params.name === 'start_run') result = await app.startRun({ issue: a.issue, rawReport: a.raw_report, evidenceMode: a.evidence_mode, trueforgeSessionId: a.trueforge_session_id });
  else if (params.name === 'submit_reproduction') result = await app.submitReproduction(a.run_id, a.proposal);
  else if (params.name === 'submit_patch') result = await app.submitPatch(a.run_id, a.patch);
  else if (params.name === 'verify_run') result = await app.verifyRun(a.run_id);
  else if (params.name === 'request_publication_approval') result = await app.requestPublicationApproval(a.run_id);
  else if (params.name === 'publish_verified_pr') result = await app.publishVerifiedPr(a.run_id);
  else if (params.name === 'get_run') result = await app.getRun(a.run_id);
  else throw new Error(`Unknown tool ${params.name}`);
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
});

await server.connect(new StdioServerTransport());

function tool(name, description, properties, required = []) {
  return { name, description, inputSchema: { type: 'object', additionalProperties: false, properties, required }, annotations: { readOnlyHint: name === 'get_run', destructiveHint: false, idempotentHint: ['get_run', 'publish_verified_pr'].includes(name) } };
}
