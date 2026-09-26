import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TrueForge } from '@truefoundry/trueforge-sdk';

const profile = process.argv.includes('--approval') ? 'approval' : 'normal';
const template = JSON.parse(await readFile(path.resolve(`trueforge/agent.${profile}.json`), 'utf8'));
template.model.name = process.env.TRUEFORGE_MODEL || template.model.name;
template.mcpServers[0].name = process.env.REDHANDED_MCP_SERVER_NAME || template.mcpServers[0].name;
template.instructions = await readFile(path.resolve(template.instructions_file), 'utf8');
delete template.instructions_file;
const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL || 'http://localhost:8790', token: process.env.TRUEFORGE_TOKEN || undefined, timeoutInSeconds: 60 });
const name = process.env.TRUEFORGE_AGENT_NAME || `redhanded-${profile}`;
let existing;
for await (const agent of await client.agents.list()) if (agent.name === name) existing = agent;
const body = { name, description: 'Turns an eligible kora-store issue into a verified pull request and stops.', manifest: template };
const response = existing ? await client.agents.update(existing.id, { description: body.description, manifest: body.manifest }) : await client.agents.create(body);
console.log(JSON.stringify({ profile, name, id: response.data.id, tools: template.mcpServers[0].enableTools, approval: template.mcpServers[0].requireApprovalForTools }, null, 2));
