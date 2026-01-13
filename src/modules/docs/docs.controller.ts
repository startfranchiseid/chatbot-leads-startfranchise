import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// OpenAPI 3.0 Specification
const openApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'Chatbot Leads API',
        description: 'WhatsApp & Telegram lead management system for StartFranchise Indonesia',
        version: '1.0.0',
        contact: {
            name: 'StartFranchise',
            url: 'https://startfranchise.id',
        },
    },
    servers: [
        {
            url: 'http://localhost:3000',
            description: 'Development server',
        },
        {
            url: 'https://api.startfranchise.id',
            description: 'Production server',
        },
    ],
    tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'WAHA', description: 'WhatsApp webhook endpoints' },
        { name: 'Telegram', description: 'Telegram bot webhook endpoints' },
        { name: 'Admin', description: 'Admin dashboard endpoints' },
        { name: 'Metrics', description: 'Monitoring and metrics endpoints' },
    ],
    paths: {
        '/health': {
            get: {
                tags: ['Health'],
                summary: 'Health check',
                description: 'Returns server health status',
                responses: {
                    '200': {
                        description: 'Server is healthy',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ok' },
                                        timestamp: { type: 'string', format: 'date-time' },
                                        uptime: { type: 'number', description: 'Uptime in seconds' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/ready': {
            get: {
                tags: ['Health'],
                summary: 'Readiness check',
                description: 'Checks if all dependencies are ready',
                responses: {
                    '200': {
                        description: 'All services ready',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ready' },
                                        services: {
                                            type: 'object',
                                            properties: {
                                                redis: { type: 'string', example: 'ok' },
                                                database: { type: 'string', example: 'ok' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    '503': { description: 'Service not ready' },
                },
            },
        },
        '/api/waha/webhook': {
            post: {
                tags: ['WAHA'],
                summary: 'WAHA webhook endpoint',
                description: 'Receives incoming WhatsApp messages from WAHA',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    event: { type: 'string', example: 'message' },
                                    payload: { type: 'object' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': { description: 'Webhook processed successfully' },
                },
            },
        },
        '/api/telegram/webhook': {
            post: {
                tags: ['Telegram'],
                summary: 'Telegram webhook endpoint',
                description: 'Receives incoming messages from Telegram Bot API',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    update_id: { type: 'integer' },
                                    message: { type: 'object' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': { description: 'Webhook processed successfully' },
                },
            },
        },
        '/api/admin/leads': {
            get: {
                tags: ['Admin'],
                summary: 'List leads',
                description: 'Get paginated list of all leads',
                parameters: [
                    {
                        name: 'state',
                        in: 'query',
                        schema: { type: 'string' },
                        description: 'Filter by lead state',
                    },
                    {
                        name: 'page',
                        in: 'query',
                        schema: { type: 'integer', default: 1 },
                        description: 'Page number',
                    },
                    {
                        name: 'limit',
                        in: 'query',
                        schema: { type: 'integer', default: 20 },
                        description: 'Items per page',
                    },
                ],
                responses: {
                    '200': {
                        description: 'List of leads',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: { type: 'array', items: { $ref: '#/components/schemas/Lead' } },
                                        pagination: { $ref: '#/components/schemas/Pagination' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/api/admin/leads/{id}': {
            get: {
                tags: ['Admin'],
                summary: 'Get lead details',
                description: 'Get detailed information about a specific lead',
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', format: 'uuid' },
                    },
                ],
                responses: {
                    '200': { description: 'Lead details' },
                    '404': { description: 'Lead not found' },
                },
            },
        },
        '/api/admin/leads/{id}/state': {
            put: {
                tags: ['Admin'],
                summary: 'Change lead state',
                description: 'Manually change lead state (admin override)',
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', format: 'uuid' },
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['state'],
                                properties: {
                                    state: {
                                        type: 'string',
                                        enum: ['NEW', 'CHOOSE_OPTION', 'FORM_SENT', 'FORM_IN_PROGRESS', 'FORM_COMPLETED', 'MANUAL_INTERVENTION', 'PARTNERSHIP', 'EXISTING'],
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': { description: 'State changed successfully' },
                    '404': { description: 'Lead not found' },
                },
            },
        },
        '/api/admin/analytics': {
            get: {
                tags: ['Admin'],
                summary: 'Dashboard analytics',
                description: 'Get lead statistics and analytics',
                responses: {
                    '200': {
                        description: 'Analytics data',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                totalLeads: { type: 'integer' },
                                                completedForms: { type: 'integer' },
                                                requiresIntervention: { type: 'integer' },
                                                conversionRate: { type: 'string' },
                                                byState: { type: 'object' },
                                                bySource: { type: 'object' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/metrics': {
            get: {
                tags: ['Metrics'],
                summary: 'Prometheus metrics',
                description: 'Returns metrics in Prometheus text format',
                responses: {
                    '200': {
                        description: 'Prometheus metrics',
                        content: {
                            'text/plain': {
                                schema: { type: 'string' },
                            },
                        },
                    },
                },
            },
        },
        '/metrics/json': {
            get: {
                tags: ['Metrics'],
                summary: 'JSON metrics',
                description: 'Returns metrics in JSON format',
                responses: {
                    '200': {
                        description: 'JSON metrics',
                        content: {
                            'application/json': {
                                schema: { type: 'object' },
                            },
                        },
                    },
                },
            },
        },
    },
    components: {
        schemas: {
            Lead: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid' },
                    user_id: { type: 'string' },
                    source: { type: 'string', enum: ['whatsapp', 'telegram'] },
                    state: {
                        type: 'string',
                        enum: ['NEW', 'CHOOSE_OPTION', 'FORM_SENT', 'FORM_IN_PROGRESS', 'FORM_COMPLETED', 'MANUAL_INTERVENTION', 'PARTNERSHIP', 'EXISTING'],
                    },
                    warning_count: { type: 'integer' },
                    created_at: { type: 'string', format: 'date-time' },
                    updated_at: { type: 'string', format: 'date-time' },
                },
            },
            Pagination: {
                type: 'object',
                properties: {
                    page: { type: 'integer' },
                    limit: { type: 'integer' },
                    total: { type: 'integer' },
                    totalPages: { type: 'integer' },
                },
            },
        },
    },
};

/**
 * API Documentation Controller
 */
export async function docsController(fastify: FastifyInstance): Promise<void> {
    /**
     * GET /api/docs - OpenAPI JSON specification
     */
    fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
        return reply.send(openApiSpec);
    });

    /**
     * GET /api/docs/openapi.json - OpenAPI specification file
     */
    fastify.get('/openapi.json', async (request: FastifyRequest, reply: FastifyReply) => {
        return reply.send(openApiSpec);
    });

    /**
     * GET /api/docs/swagger - Swagger UI HTML
     */
    fastify.get('/swagger', async (request: FastifyRequest, reply: FastifyReply) => {
        const host = request.headers.host || 'localhost:3000';
        const protocol = request.protocol || 'http';

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chatbot Leads API - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${protocol}://${host}/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        deepLinking: true,
      });
    };
  </script>
</body>
</html>`;

        reply.header('Content-Type', 'text/html');
        return reply.send(html);
    });
}
