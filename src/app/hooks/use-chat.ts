import { useAtom } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'
import { trackEvent } from '~app/plausible'
import { chatFamily } from '~app/state'
import { setConversationMessages } from '~services/chat-history'
import { ChatMessageModel } from '~types'
import { uuid } from '~utils'
import { BotId } from '../bots'
import md5 from 'md5'
import { get as gGet, set as gSet } from '../state/global'

export function useChat(botId: BotId, page = 'singleton') {
  const chatAtom = useMemo(() => chatFamily({ botId, page }), [botId, page])
  const [chatState, setChatState] = useAtom(chatAtom)

  const updateMessage = useCallback(
    (messageId: string, updater: (message: ChatMessageModel) => void) => {
      setChatState((draft) => {
        const message = draft.messages.find((m) => m.id === messageId)
        if (message) {
          updater(message)
        }
      })
    },
    [setChatState],
  )

  const sendMessage = useCallback(
    async (input: string) => {
      trackEvent('send_message', { botId })
      const botMessageId = uuid()
      setChatState((draft) => {
        draft.messages.push({ id: uuid(), text: input, author: 'user' }, { id: botMessageId, text: '', author: botId })
      })
      const abortController = new AbortController()
      setChatState((draft) => {
        draft.generatingMessageId = botMessageId
        draft.abortController = abortController
      })
      const socket = gGet('socket')
      const uid = md5(input)
      await chatState.bot.sendMessage({
        prompt: input,
        signal: abortController.signal,
        onEvent(event) {
          if (event.type === 'UPDATE_ANSWER') {
            // updateMessage(botMessageId, (message) => {
            //   message.text = event.data.text
            // })
            socket.send(JSON.stringify({
              type: 'UPDATE_ANSWER',
              uid,
              content: event.data.text
            }))
          } else if (event.type === 'ERROR') {
            console.error('sendMessage error', event.error.code, event.error)
            // updateMessage(botMessageId, (message) => {
            //   message.error = event.error
            // })
            // setChatState((draft) => {
            //   draft.abortController = undefined
            //   draft.generatingMessageId = ''
            // })
            socket.send(JSON.stringify({
              type: 'ERROR',
              uid,
              content: ''
            }))
          } else if (event.type === 'DONE') {
            socket.send(JSON.stringify({
              type: 'DONE',
              uid,
              content: ''
            }))
            // setChatState((draft) => {
            //   draft.abortController = undefined
            //   draft.generatingMessageId = ''
            // })
          }
        },
      })
    },
    [botId, chatState.bot, setChatState, updateMessage],
  )

  const resetConversation = useCallback(() => {
    chatState.bot.resetConversation()
    setChatState((draft) => {
      draft.abortController = undefined
      draft.generatingMessageId = ''
      draft.messages = []
      draft.conversationId = uuid()
    })
  }, [chatState.bot, setChatState])

  const stopGenerating = useCallback(() => {
    chatState.abortController?.abort()
    if (chatState.generatingMessageId) {
      updateMessage(chatState.generatingMessageId, (message) => {
        if (!message.text && !message.error) {
          message.text = 'Cancelled'
        }
      })
    }
    setChatState((draft) => {
      draft.generatingMessageId = ''
    })
  }, [chatState.abortController, chatState.generatingMessageId, setChatState, updateMessage])

  useEffect(() => {
    if (chatState.messages.length) {
      setConversationMessages(botId, chatState.conversationId, chatState.messages)
    }
  }, [botId, chatState.conversationId, chatState.messages])

  const chat = useMemo(
    () => ({
      botId,
      messages: chatState.messages,
      sendMessage,
      resetConversation,
      generating: !!chatState.generatingMessageId,
      stopGenerating,
    }),
    [botId, chatState.generatingMessageId, chatState.messages, resetConversation, sendMessage, stopGenerating],
  )

  return chat
}
