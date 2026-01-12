// Lead State Machine Types
export const LeadStates = {
  NEW: 'NEW',
  EXISTING: 'EXISTING', // Nomor lama yang sudah pernah chat - BOT TIDAK RESPOND
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
  whatsapp_lid?: string | null; // Alternative WhatsApp Linked ID (@lid format)
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
  biodata: string | null;        // Name, location, etc.
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
  // Additional metadata for cross-referencing
  metadata?: {
    lid?: string | null;      // WhatsApp Linked ID (@lid format)
    phone?: string | null;    // Phone number (@s.whatsapp.net format)
    pushName?: string | null; // Display name from WhatsApp
  };
}

// WAHA Webhook Payload (Updated for NOWEB engine format)
export interface WAHAWebhookPayload {
  id?: string;              // Event ID (evt_xxx)
  timestamp?: number;       // Event timestamp
  event: string;            // 'message', 'message.any', etc.
  session: string;          // Session name
  me?: {                    // Bot account info
    id: string;
    pushName: string;
    lid?: string;
  };
  payload: {
    id: string;             // Message ID
    from: string;           // Sender (can be @lid or @s.whatsapp.net)
    to?: string;            // Recipient
    body: string;           // Message text
    fromMe: boolean;        // Is from self
    isGroup?: boolean;      // Is group message
    timestamp: number;      // Message timestamp
    chatId?: string;        // Chat ID
    hasMedia?: boolean;
    source?: string;        // 'app', 'web', etc.
    ack?: number;
    ackName?: string;
    // Extended data from WAHA NOWEB engine
    _data?: {
      key?: {
        remoteJid?: string;      // Same as from
        remoteJidAlt?: string;   // Alternative ID (phone if from is LID)
        fromMe?: boolean;
        id?: string;             // Message unique ID
        participant?: string;
        addressingMode?: string; // 'lid' or 'phone'
      };
      messageTimestamp?: number;
      pushName?: string;         // Sender display name
      broadcast?: boolean;
      message?: {
        conversation?: string;
      };
      status?: number;
    };
  };
  engine?: string;          // 'NOWEB'
  environment?: {
    version: string;
    engine: string;
    tier: string;
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
