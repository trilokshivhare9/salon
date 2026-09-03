import { ApiClient, formatTime12h } from './api.js';

export class WhatsAppSimulator {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentSalonSlug = 'glamour-studio';
    this.customerPhone = '+919811122233';
    this.messages = [
      {
        sender: 'bot',
        text: '👋 *Welcome to Glamour Studio & Lounge!*\n\nHow can we help you today?\n\n*1.* 📅 Book an Appointment\n*2.* ✂️ View Services Menu\n*3.* 📍 Salon Address & Timings\n\n_Reply with *1*, *2*, or *3* to continue._',
        time: 'Just now',
      },
    ];
  }

  init() {
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div style="max-width: 500px; margin: 20px auto; padding: 0 12px;">
        <!-- Salon & Phone Config Controls -->
        <div class="glass-panel" style="margin-bottom: 16px; padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-size: 0.85rem; font-weight: 700; color: #818cf8; text-transform: uppercase;">WhatsApp Sandbox Testing</div>
            <span class="badge" style="background: rgba(37, 211, 102, 0.15); color: #25D366; border: 1px solid rgba(37, 211, 102, 0.3);">Live State Machine</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="font-size: 0.75rem; color: var(--text-muted);">Target Salon Slug</label>
              <input type="text" class="form-control" id="sim-salon-slug" value="${this.currentSalonSlug}" style="padding: 6px 10px; font-size: 0.85rem;" />
            </div>
            <div>
              <label style="font-size: 0.75rem; color: var(--text-muted);">Customer Phone</label>
              <input type="tel" class="form-control" id="sim-customer-phone" value="${this.customerPhone}" style="padding: 6px 10px; font-size: 0.85rem;" />
            </div>
          </div>
        </div>

        <!-- WhatsApp Phone Mockup Frame -->
        <div style="background: #0b141a; border: 2px solid #202c33; border-radius: 28px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.8);">
          <!-- Top WhatsApp Bar -->
          <div style="background: #202c33; padding: 12px 16px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #111b21;">
            <div style="width: 40px; height: 40px; border-radius: 50%; background: #25D366; display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">
              ✂️
            </div>
            <div style="flex: 1;">
              <div style="font-weight: 700; color: #e9edef; font-size: 0.95rem;" id="sim-display-name">Glamour Studio Bot</div>
              <div style="font-size: 0.75rem; color: #25D366;">● Official WhatsApp Business</div>
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-reset-chat" style="padding: 4px 8px; font-size: 0.75rem;">Reset</button>
          </div>

          <!-- Chat Messages Area -->
          <div id="chat-messages-box" style="height: 480px; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background-image: radial-gradient(#182229 1px, transparent 1px); background-size: 16px 16px;">
            ${this.renderMessages()}
          </div>

          <!-- Message Input Bar -->
          <div style="background: #202c33; padding: 10px 14px; display: flex; gap: 8px; align-items: center;">
            <input type="text" id="sim-message-input" placeholder="Type a message (e.g. 1, Rahul, Confirm)..." style="flex: 1; background: #2a3942; border: none; border-radius: 20px; padding: 10px 16px; color: #fff; font-size: 0.9rem; outline: none;" />
            <button id="btn-send-msg" style="width: 40px; height: 40px; border-radius: 50%; background: #00a884; border: none; color: #fff; cursor: pointer; font-size: 1.1rem; display: flex; align-items: center; justify-content: center;">
              ➤
            </button>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.scrollToBottom();
  }

  renderMessages() {
    return this.messages.map(m => {
      const isUser = m.sender === 'user';
      // Format markdown in text (*bold*, _italic_)
      const formattedText = m.text
        .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
        .replace(/_(.*?)_/g, '<em>$1</em>')
        .replace(/\n/g, '<br />');

      return `
        <div style="display: flex; justify-content: ${isUser ? 'flex-end' : 'flex-start'};">
          <div style="max-width: 82%; padding: 10px 14px; border-radius: ${isUser ? '12px 0 12px 12px' : '0 12px 12px 12px'}; background: ${isUser ? '#005c4b' : '#202c33'}; color: #e9edef; font-size: 0.88rem; line-height: 1.45; box-shadow: 0 1px 2px rgba(0,0,0,0.3);">
            <div>${formattedText}</div>
            <div style="font-size: 0.65rem; color: #8696a0; text-align: right; margin-top: 4px;">${m.time}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  scrollToBottom() {
    const box = document.getElementById('chat-messages-box');
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }

  async sendMessage(text) {
    if (!text || !text.trim()) return;
    const msgText = text.trim();

    // Push user message
    this.messages.push({
      sender: 'user',
      text: msgText,
      time: formatTime12h(new Date()),
    });
    this.render();

    const slug = document.getElementById('sim-salon-slug')?.value || this.currentSalonSlug;
    const phone = document.getElementById('sim-customer-phone')?.value || this.customerPhone;

    try {
      const res = await ApiClient.request('/whatsapp/simulate', {
        method: 'POST',
        body: JSON.stringify({
          salonSlug: slug,
          customerPhone: phone,
          messageText: msgText,
        }),
      });

      this.messages.push({
        sender: 'bot',
        text: res.replyMessage || 'No response from salon bot.',
        time: formatTime12h(new Date()),
      });
      this.render();
    } catch (err) {
      this.messages.push({
        sender: 'bot',
        text: `⚠️ Error: ${err.message}`,
        time: formatTime12h(new Date()),
      });
      this.render();
    }
  }

  attachEventListeners() {
    const input = document.getElementById('sim-message-input');
    const sendBtn = document.getElementById('btn-send-msg');
    const resetBtn = document.getElementById('btn-reset-chat');

    input?.focus();

    sendBtn?.addEventListener('click', () => {
      this.sendMessage(input.value);
      input.value = '';
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage(input.value);
        input.value = '';
      }
    });

    resetBtn?.addEventListener('click', () => {
      this.sendMessage('Hi');
    });
  }
}
