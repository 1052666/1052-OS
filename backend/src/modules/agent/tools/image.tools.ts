import type { AgentTool } from '../agent.tool.types.js'
import { generateImages } from '../../images/image-generation.service.js'

export const imageTools: AgentTool[] = [
  {
    name: 'image_generate',
    description:
      'Built-in 1052 OS image generation. Generate one or more images from a text prompt using the configured image generation API. The backend supports OpenAI-compatible image endpoints and Gemini native image generation. Use this when the user explicitly asks to create, draw, render, design, or generate an image, illustration, poster, logo concept, cover, wallpaper, avatar, or similar visual output. Do not use web search or UAPIs as a substitute for image creation unless the user asks for reference research or existing images.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The image prompt describing the desired visual result.',
        },
        count: {
          type: 'number',
          description: 'How many images to generate. Default 1, max 4.',
        },
        size: {
          type: 'string',
          enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
          description: 'Optional image size override.',
        },
        quality: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
          description: 'Optional quality override.',
        },
        background: {
          type: 'string',
          enum: ['auto', 'opaque', 'transparent'],
          description: 'Optional background override.',
        },
        outputFormat: {
          type: 'string',
          enum: ['png', 'jpeg', 'webp'],
          description: 'Optional output format override.',
        },
        outputCompression: {
          type: 'number',
          description: 'Optional compression override for jpeg/webp, 0-100.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      if (typeof input.count === 'number') input.count = Math.min(Math.max(input.count, 1), 4)
      if (typeof input.outputCompression === 'number') input.outputCompression = Math.min(Math.max(input.outputCompression, 0), 100)
      return generateImages(input)
    },
  },
]
