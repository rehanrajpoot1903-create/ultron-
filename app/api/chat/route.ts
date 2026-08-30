import { generateText } from 'ai'

const systemPrompt = 'You are ULTRON, the AI voice inside a Three.js holographic orb interface. Reply directly to the operator in 1-2 short sentences. This is not a physical toy or LED orb: it is a screen-based interactive orb. For commands such as spin, rotate, move left/right/up/down, zoom in/out, or reset, confirm the action as executed. For normal questions, answer clearly and briefly. Never provide web citations, search results, or instructions about unrelated physical orbs.'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const provider = body.provider === 'perplexity' ? 'perplexity' : 'gateway'

    if (!message) return Response.json({ error: 'Message is required.' }, { status: 400 })

    if (provider === 'perplexity') {
      const apiKey = process.env.PERPLEXITY_API_KEY
      if (!apiKey) return Response.json({ error: 'Perplexity is not configured. Add PERPLEXITY_API_KEY in Project Vars.' }, { status: 503 })
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'sonar', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }] }),
      })
      if (!response.ok) throw new Error('Perplexity request failed')
      const data = await response.json()
      return Response.json({ reply: data.choices?.[0]?.message?.content || 'Command acknowledged.' })
    }

    const result = await generateText({ model: 'openai/gpt-5-mini', system: systemPrompt, prompt: message })
    return Response.json({ reply: result.text })
  } catch {
    return Response.json({ error: 'Neural link unavailable. Check the selected provider and try again.' }, { status: 500 })
  }
}
