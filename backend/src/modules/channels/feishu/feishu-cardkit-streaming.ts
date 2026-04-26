import * as Lark from '@larksuiteoapi/node-sdk'

export type CardKitStreamingSessionOptions = {
  headerTitle?: string
  template?: string
  elementId?: string
}

export type CardKitStreamingSessionState = {
  cardId: string | null
  messageId: string | null
  sequence: number
  currentText: string
}

type FeishuCardJson = Record<string, unknown>

const DEFAULT_ELEMENT_ID = 'progress_text'

/**
 * Manages one Feishu CardKit native streaming card lifecycle.
 *
 * The session creates a CardKit card with `streaming_mode: true`, sends it to a
 * chat, streams full markdown content into one card element, then replaces the
 * card with a final payload and disables streaming mode.
 */
export class CardKitStreamingSession {
  private cardId: string | null = null
  private messageId: string | null = null
  private sequence = 0
  private currentText = ''

  constructor(
    private readonly client: Lark.Client,
    private readonly chatId: string,
    private readonly opts?: CardKitStreamingSessionOptions,
  ) {}

  private nextSeq(): number {
    return ++this.sequence
  }

  /**
   * Creates a `streaming_mode: true` CardKit card and sends it to the target chat.
   */
  async startProcessing(initialMarkdown: string): Promise<void> {
    const elementId = this.opts?.elementId ?? DEFAULT_ELEMENT_ID
    const cardJson: FeishuCardJson = {
      schema: '2.0',
      config: { streaming_mode: true, summary: { content: '处理中...' } },
      header: {
        title: { tag: 'plain_text', content: this.opts?.headerTitle ?? '处理中' },
        template: this.opts?.template ?? 'blue',
      },
      body: {
        direction: 'vertical',
        elements: [
          {
            tag: 'markdown',
            content: initialMarkdown,
            element_id: elementId,
          },
        ],
      },
    }

    const createRes = await this.client.cardkit.v1.card.create({
      data: { type: 'card_json', data: JSON.stringify(cardJson) },
    })
    this.cardId = createRes.data?.card_id ?? null
    if (!this.cardId) {
      throw new Error('CardKit: card_id missing in create response')
    }

    const sendRes = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: this.chatId,
        msg_type: 'interactive',
        content: JSON.stringify({ type: 'card', data: { card_id: this.cardId } }),
      },
    })
    this.messageId = sendRes.data?.message_id ?? null
    this.currentText = initialMarkdown
  }

  /**
   * Appends one line and pushes the full markdown text to the streaming element.
   * Feishu computes and renders the incremental card update.
   */
  async pushProgress(line: string): Promise<void> {
    if (!this.cardId) {
      throw new Error('CardKit: startProcessing must be called first')
    }

    this.currentText = `${this.currentText}\n${line}`
    const elementId = this.opts?.elementId ?? DEFAULT_ELEMENT_ID
    await this.client.cardkit.v1.cardElement.content({
      data: { content: this.currentText, sequence: this.nextSeq() },
      path: { card_id: this.cardId, element_id: elementId },
    })
  }

  /**
   * Replaces the card with its final card JSON and turns off native streaming.
   */
  async finalize(finalCard: FeishuCardJson): Promise<void> {
    if (!this.cardId) {
      throw new Error('CardKit: startProcessing must be called first')
    }

    await this.client.cardkit.v1.card.update({
      data: {
        card: { type: 'card_json', data: JSON.stringify(finalCard) },
        sequence: this.nextSeq(),
      },
      path: { card_id: this.cardId },
    })
    await this.client.cardkit.v1.card.settings({
      data: {
        settings: JSON.stringify({
          config: { streaming_mode: false, summary: { content: '完成' } },
        }),
        sequence: this.nextSeq(),
      },
      path: { card_id: this.cardId },
    })
  }

  /**
   * Returns the current local CardKit identifiers, sequence, and streamed text.
   */
  get state(): CardKitStreamingSessionState {
    return {
      cardId: this.cardId,
      messageId: this.messageId,
      sequence: this.sequence,
      currentText: this.currentText,
    }
  }
}
