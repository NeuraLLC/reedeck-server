/**
 * Realtime Broadcast Helper
 *
 * Uses Supabase's httpSend() (REST API) to reliably deliver broadcast
 * events to dashboard clients. This avoids the WebSocket subscription
 * requirement that caused inconsistent delivery.
 */

import { supabaseAdmin } from '../config/supabase';
import logger from '../config/logger';

export async function broadcastTicketEvent(
  organizationId: string,
  event: 'ticket_created' | 'ticket_updated',
  ticketId: string
): Promise<void> {
  try {
    const channel = supabaseAdmin.channel(`org:${organizationId}`);
    const result = await channel.send({
      type: 'broadcast',
      event,
      payload: { ticketId },
    });

    if (result !== 'ok') {
      logger.warn(`Broadcast ${event} for ticket ${ticketId} returned: ${result}`);
    }
  } catch (error) {
    logger.error(`Failed to broadcast ${event} for ticket ${ticketId}:`, error);
  }
}
