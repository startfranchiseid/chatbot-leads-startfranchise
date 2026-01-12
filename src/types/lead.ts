// Lead State Machine Types
export const LeadStates = {
  NEW: 'NEW',
  CHOOSE_OPTION: 'CHOOSE_OPTION',
  FORM_SENT: 'FORM_SENT',
  FORM_IN_PROGRESS: 'FORM_IN_PROGRESS',
  FORM_COMPLETED: 'FORM_COMPLETED',
  MANUAL_INTERVENTION: 'MANUAL_INTERVENTION',
  PARTNERSHIP: 'PARTNERSHIP',
} as const;

export type LeadState = (typeof LeadStates)[keyof typeof LeadStates];

// Message Source Types
export const MessageSources = {
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
} as const;

export type MessageSource = (typeof MessageSources)[keyof typeof MessageSources];

// Message Direction Types
export const MessageDirections = {
  IN: 'in',
  OUT: 'out',
} as const;

export type MessageDirection = (typeof MessageDirections)[keyof typeof MessageDirections];

// Lead Entity
export interface Lead {
  id: string;
  user_id: string;
  source: MessageSource;
  state: LeadState;
  warning_count: number;
  created_at: Date;
  updated_at: Date;
}

// Lead Interaction Entity
export interface LeadInteraction {
  id: string;
  lead_id: string;
  message_id: string;
  message: string;
  direction: MessageDirection;
  created_at: Date;
}

// Lead Form Data Entity
export interface LeadFormData {
  id: string;
  lead_id: string;
  source_info: string | null;
  business_type: string | null;
  budget: string | null;
  start_plan: string | null;
  completed: boolean;
  created_at: Date;
}

// Inbound Message Types
export interface InboundMessage {
  source: MessageSource;
  messageId: string;
  userId: string;
  text: string;
  fromMe: boolean;
  isGroup: boolean;
  isBroadcast: boolean;
  timestamp: number;
  rawPayload?: unknown;
}

// WAHA Webhook Payload
export interface WAHAWebhookPayload {
  event: string;
  session: string;
  payload: {
    id: string;
    from: string;
    to: string;
    body: string;
    fromMe: boolean;
    isGroup: boolean;
    timestamp: number;
    chatId: string;
    hasMedia: boolean;
  };
}

// Telegram Update Payload
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: 'private' | 'group' | 'supergroup' | 'channel';
    };
    date: number;
    text?: string;
  };
}

// State Transition Result
export interface StateTransitionResult {
  success: boolean;
  previousState: LeadState;
  newState: LeadState;
  error?: string;
}

// Message Handler Result
export interface MessageHandlerResult {
  success: boolean;
  shouldReply: boolean;
  replyMessage?: string;
  error?: string;
}

// Form Validation Result
export interface FormValidationResult {
  valid: boolean;
  parsedData?: Partial<LeadFormData>;
  errors?: string[];
}

// Escalation Info
export interface EscalationInfo {
  userId: string;
  lastMessage: string;
  currentState: LeadState;
  warningCount: number;
  source: MessageSource;
  timestamp: Date;
}
