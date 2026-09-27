// tools/nextchat-mcp-stub.ts
// Drop-in replacement for NextChat's app/mcp/actions.ts when building the static
// export embed. The upstream file uses "use server" (Server Actions), which
// Next.js rejects for `output: 'export'`. Copy this over it before building —
// same export names, all no-ops; the MCP (App Store) feature is disabled, chat
// is unaffected. See docs/embed-nextchat.md.
/* eslint-disable */
export async function getClientsStatus(..._a: any[]): Promise<any> { return []; }
export async function getClientTools(..._a: any[]): Promise<any> { return []; }
export async function getAvailableClientsCount(..._a: any[]): Promise<any> { return 0; }
export async function getAllTools(..._a: any[]): Promise<any> { return []; }
export async function initializeMcpSystem(..._a: any[]): Promise<any> { return null; }
export async function addMcpServer(..._a: any[]): Promise<any> { return null; }
export async function pauseMcpServer(..._a: any[]): Promise<any> { return null; }
export async function resumeMcpServer(..._a: any[]): Promise<any> { return null; }
export async function removeMcpServer(..._a: any[]): Promise<any> { return null; }
export async function restartAllClients(..._a: any[]): Promise<any> { return null; }
export async function executeMcpAction(..._a: any[]): Promise<any> { return null; }
export async function getMcpConfigFromFile(..._a: any[]): Promise<any> { return { clients: [] }; }
export async function isMcpEnabled(..._a: any[]): Promise<any> { return false; }