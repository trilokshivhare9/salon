import { ConversationState } from '@prisma/client';

export interface ActionContext {
  salonId: string;
  customerPhone: string;
  cleanNumber: string;
  input: string;
  normalizedInput: string;
  salon: any;
  user: any;
  salonUser: any;
  conversation: any;
  activeAppointment: any;
  targetAppointment: any;
  pendingAppointment?: any;
  phoneNumberId?: string;
  senderName?: string;
  tz: string;
}

export interface ActionResult {
  replyMessage: string;
  state: ConversationState;
  metadata?: any;
}
