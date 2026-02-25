const { getFirestore, getMessaging } = require('./firebase');
const cron = require('node-cron');

class NotificationService {
  constructor() {
    this.firestore = getFirestore();
    this.messaging = getMessaging();
    this.eventCache = new Map();
    this.serverStartTime = new Date();
    this.isInitialLoad = true;
  }

  /* =========================================================
   * SEND TO ALL USERS (FCM TOPIC BROADCAST)
   * ======================================================= */
  async sendToAll(title, body, data = {}) {
    try {
      const message = this._buildMessage({
        title,
        body,
        data,
        target: { topic: 'all_users' },
      });

      const response = await this.messaging.send(message);
      console.log('✅ Notification sent to all users:', title);

      await this.firestore.collection('notification_logs').add({
        title,
        body,
        data,
        success: true,
        sentAt: new Date(),
        target: 'all_users',
        messageId: response,
      });

      return { success: true, messageId: response };
    } catch (error) {
      console.error('❌ Error sending notification:', error.message);
      await this._logError({ title, body, error });
      throw error;
    }
  }

  /* =========================================================
   * SEND TO SPECIFIC DEVICE TOKEN
   * ======================================================= */
  async sendToDevice(token, title, body, data = {}) {
    try {
      const message = this._buildMessage({
        title,
        body,
        data,
        target: { token },
      });

      const response = await this.messaging.send(message);
      console.log('✅ Notification sent to device:', title);

      await this.firestore.collection('notification_logs').add({
        title,
        body,
        data,
        success: true,
        sentAt: new Date(),
        target: 'device',
        messageId: response,
      });

      return { success: true, messageId: response };
    } catch (error) {
      console.error('❌ Error sending device notification:', error.message);
      await this._logError({ title, body, error });
      throw error;
    }
  }

  /* =========================================================
   * NEW EVENT NOTIFICATION
   * ======================================================= */
  async sendNewEventNotification(event) {
    try {
      const eventDate = this.toDate(event.dateTime);
      const formattedDate = this.formatEventDate(eventDate);

      console.log(`📢 Sending NEW EVENT notification: ${event.title}`);
      console.log(`   Date: ${formattedDate}`);

      await this.firestore.collection('event_notifications').doc(event.id).set({
        eventId: event.id,
        eventTitle: event.title,
        type: 'new_event',
        lastNotifiedDate: event.dateTime,
        notifiedAt: new Date(),
      });

      await this.sendToAll(
        `🎉 New Event: ${event.title}`,
        `${formattedDate} • ${event.location || 'TBD'}`,
        {
          type: 'new_event',
          eventId: String(event.id),
          route: 'events',
          imageUrl: event.imageUrl || '',
        }
      );

      console.log('✅ New event notification sent and recorded');
    } catch (error) {
      console.error('❌ Error sending new event notification:', error.message);
    }
  }

  /* =========================================================
   * EVENT DATE CHANGED NOTIFICATION - FIXED
   * ======================================================= */
  async sendEventDateChangedNotification(event, oldDateTime, newDateTime) {
    try {
      // ✅ FIX: Convert to proper Date objects
      const oldDate = this.toDate(oldDateTime);
      const newDate = this.toDate(newDateTime);
      
      // ✅ FIX: Format dates properly
      const oldFormatted = this.formatEventDate(oldDate);
      const newFormatted = this.formatEventDate(newDate);

      console.log(`📅 Sending DATE CHANGED notification for: ${event.title}`);
      console.log(`   Old Date: ${oldFormatted}`);
      console.log(`   New Date: ${newFormatted}`);

      // ✅ FIX: Show BOTH dates in notification body
      await this.sendToAll(
        `⏰ Event Rescheduled: ${event.title}`,
        `New: ${newFormatted}\nOld: ${oldFormatted}`,  // ✅ Both dates visible
        {
          type: 'event_rescheduled',
          eventId: String(event.id),
          route: 'events',
          imageUrl: event.imageUrl || '',
          oldDate: oldFormatted,  // ✅ Include in data
          newDate: newFormatted,  // ✅ Include in data
        }
      );

      await this.firestore.collection('event_notifications').doc(event.id).set(
        {
          eventId: event.id,
          eventTitle: event.title,
          type: 'date_modified',
          lastNotifiedDate: event.dateTime,
          notifiedAt: new Date(),
          oldDate: oldDateTime,
          newDate: newDateTime,
        },
        { merge: true }
      );

      console.log('✅ Date changed notification sent successfully');
    } catch (error) {
      console.error('❌ Error sending date changed notification:', error.message);
      console.error('   Error details:', error);
    }
  }

  /* =========================================================
   * FIRESTORE REAL-TIME EVENT LISTENER
   * ======================================================= */
  startEventListener() {
    console.log('👂 Starting Firestore event listener...');

    const unsubscribe = this.firestore
      .collection('events')
      .onSnapshot(
        async (snapshot) => {
          const changes = snapshot.docChanges();
          if (changes.length === 0) return;

          // Skip initial load
          if (this.isInitialLoad) {
            console.log(
              `🔄 Initial load: caching ${changes.length} existing event(s) — skipping notifications`
            );
            changes.forEach((change) => {
              const event = { id: change.doc.id, ...change.doc.data() };
              if (event.dateTime) {
                this.eventCache.set(event.id, event.dateTime);
              }
            });
            this.isInitialLoad = false;
            console.log('✅ Initial load complete — now listening for real changes');
            return;
          }

          console.log(`📊 Received ${changes.length} real change(s)`);

          for (const change of changes) {
            try {
              const event = { id: change.doc.id, ...change.doc.data() };

              // Validate required fields
              if (!event.title) {
                console.warn(`⚠️  Event ${event.id} missing title — skipping`);
                continue;
              }
              if (!event.dateTime) {
                console.warn(`⚠️  Event ${event.id} missing dateTime — skipping`);
                continue;
              }

              // Skip inactive events
              if (!event.isActive) {
                console.log(`⏭️  Skipping inactive event: ${event.title}`);
                continue;
              }

              // Skip past events
              const eventDate = this.toDate(event.dateTime);
              if (eventDate <= new Date()) {
                console.log(`⏭️  Skipping past event: ${event.title}`);
                continue;
              }

              /* ----- NEW EVENT ADDED ----- */
              if (change.type === 'added') {
                console.log(`🆕 Genuinely new event: ${event.title}`);

                const existing = await this.firestore
                  .collection('event_notifications')
                  .doc(event.id)
                  .get();

                if (!existing.exists) {
                  await this.sendNewEventNotification(event);
                  this.eventCache.set(event.id, event.dateTime);
                } else {
                  console.log(`ℹ️  Already notified for: ${event.title} — skipping`);
                  this.eventCache.set(event.id, existing.data().lastNotifiedDate);
                }
              }

              /* ----- EVENT MODIFIED ----- */
              if (change.type === 'modified') {
                console.log(`🔄 Event modified: ${event.title}`);

                let oldDateTime = null;

                // Layer 1: in-memory cache
                if (this.eventCache.has(event.id)) {
                  oldDateTime = this.eventCache.get(event.id);
                  console.log(`   📋 Got old date from memory cache`);
                }

                // Layer 2: Firestore record
                if (!oldDateTime) {
                  const notifDoc = await this.firestore
                    .collection('event_notifications')
                    .doc(event.id)
                    .get();
                  if (notifDoc.exists) {
                    oldDateTime = notifDoc.data().lastNotifiedDate;
                    console.log(`   📋 Got old date from Firestore`);
                  }
                }

                // Layer 3: no record — treat as new event
                if (!oldDateTime) {
                  console.log(
                    `   ⚠️  No previous record for ${event.title} — treating as new`
                  );
                  await this.sendNewEventNotification(event);
                  this.eventCache.set(event.id, event.dateTime);
                  continue;
                }

                const newDateTime = event.dateTime;
                const oldTime = this.toTimestamp(oldDateTime);
                const newTime = this.toTimestamp(newDateTime);

                console.log(`   Old timestamp: ${oldTime}`);
                console.log(`   New timestamp: ${newTime}`);

                // ✅ FIX: Compare timestamps properly
                if (oldTime !== newTime) {
                  console.log('   ✅ Date changed — sending rescheduled notification...');
                  await this.sendEventDateChangedNotification(
                    event,
                    oldDateTime,
                    newDateTime
                  );
                  this.eventCache.set(event.id, event.dateTime);
                } else {
                  console.log('   ℹ️  Date unchanged — no notification needed');
                  this.eventCache.set(event.id, event.dateTime);
                }
              }

              /* ----- EVENT DELETED ----- */
              if (change.type === 'removed') {
                console.log(`🗑️  Event removed: ${event.id}`);
                this.eventCache.delete(event.id);
              }
            } catch (error) {
              console.error(
                '❌ Error processing change for event:',
                change.doc.id,
                error.message
              );
            }
          }
        },
        (error) => {
          console.error('❌ Snapshot listener error:', error.message);
          this.isInitialLoad = true;
          setTimeout(() => {
            console.log('🔄 Restarting event listener...');
            this.startEventListener();
          }, 5000);
        }
      );

    console.log('✅ Event listener started successfully');
    return unsubscribe;
  }

  /* =========================================================
   * DAILY REMINDERS
   * ======================================================= */
  scheduleDailyReminders() {
    console.log('⏰ Scheduling daily reminders at 9:00 AM Asia/Kathmandu...');

    cron.schedule(
      '0 9 * * *',
      async () => {
        console.log('🔔 Running daily reminder check...');

        try {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const tomorrowMs = now.getTime() + 86_400_000;

          const snapshot = await this.firestore
            .collection('events')
            .where('isActive', '==', true)
            .get();

          const todayEvents = [];
          const tomorrowEvents = [];

          snapshot.forEach((doc) => {
            const event = { id: doc.id, ...doc.data() };
            const eventDate = this.toDate(event.dateTime);
            eventDate.setHours(0, 0, 0, 0);
            const t = eventDate.getTime();

            if (t === now.getTime()) {
              todayEvents.push(event);
            } else if (t === tomorrowMs) {
              tomorrowEvents.push(event);
            }
          });

          if (todayEvents.length > 0) {
            await this.sendToAll(
              `🔥 Events Today (${todayEvents.length})`,
              todayEvents
                .map((e) => `• ${e.title}`)
                .join('\n')
                .substring(0, 100),
              { type: 'daily_reminder', route: 'events' }
            );
            console.log(`✅ Sent today reminder for ${todayEvents.length} event(s)`);
          }

          if (tomorrowEvents.length > 0) {
            await this.sendToAll(
              `📅 Tomorrow's Events (${tomorrowEvents.length})`,
              tomorrowEvents
                .map((e) => `• ${e.title}`)
                .join('\n')
                .substring(0, 100),
              { type: 'daily_reminder', route: 'events' }
            );
            console.log(`✅ Sent tomorrow reminder for ${tomorrowEvents.length} event(s)`);
          }

          if (todayEvents.length === 0 && tomorrowEvents.length === 0) {
            console.log('ℹ️  No upcoming events to remind about today');
          }

          console.log('✅ Daily reminder check completed');
        } catch (error) {
          console.error('❌ Error in daily reminder:', error.message);
        }
      },
      { timezone: 'Asia/Kathmandu' }
    );

    console.log('✅ Daily reminder scheduled successfully');
  }

  /* =========================================================
   * MANUAL TRIGGER
   * ======================================================= */
  async sendEventNotification(eventId) {
    console.log(`📢 Manual trigger for event: ${eventId}`);

    const eventDoc = await this.firestore.collection('events').doc(eventId).get();

    if (!eventDoc.exists) {
      throw new Error('Event not found');
    }

    const event = { id: eventDoc.id, ...eventDoc.data() };
    await this.sendNewEventNotification(event);
    return { success: true, message: 'Notification sent' };
  }

  /* =========================================================
   * STATS
   * ======================================================= */
  async getStats() {
    try {
      const [logsSnap, errorsSnap] = await Promise.all([
        this.firestore
          .collection('notification_logs')
          .orderBy('sentAt', 'desc')
          .limit(100)
          .get(),
        this.firestore
          .collection('notification_errors')
          .orderBy('sentAt', 'desc')
          .limit(100)
          .get(),
      ]);

      return {
        totalSent: logsSnap.size,
        totalErrors: errorsSnap.size,
        recentLogs: logsSnap.docs
          .slice(0, 10)
          .map((d) => ({ id: d.id, ...d.data() })),
        recentErrors: errorsSnap.docs
          .slice(0, 10)
          .map((d) => ({ id: d.id, ...d.data() })),
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error.message);
      return { error: error.message };
    }
  }

  /* =========================================================
   * PRIVATE HELPERS
   * ======================================================= */

  _buildMessage({ title, body, data = {}, target }) {
    const fcmData = {};
    for (const [k, v] of Object.entries(data)) {
      fcmData[k] = String(v);
    }

    fcmData.type = fcmData.type || 'announcement';
    fcmData.timestamp = new Date().toISOString();
    fcmData.click_action = 'FLUTTER_NOTIFICATION_CLICK';

    const imageUrl =
      data.imageUrl && String(data.imageUrl).trim() !== ''
        ? String(data.imageUrl)
        : undefined;

    return {
      notification: { title, body },
      data: fcmData,
      android: {
        priority: 'high',
        notification: {
          channelId: 'events_channel',
          sound: 'default',
          ...(imageUrl && { imageUrl }),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'mutable-content': 1,
          },
        },
        ...(imageUrl && { fcm_options: { image: imageUrl } }),
      },
      ...target,
    };
  }

  async _logError({ title, body, error }) {
    try {
      await this.firestore.collection('notification_errors').add({
        title,
        body,
        error: error.message,
        sentAt: new Date(),
      });
    } catch (logErr) {
      console.error('❌ Failed to log error to Firestore:', logErr.message);
    }
  }

  // ✅ FIX: Improved date conversion
  toDate(value) {
    if (!value) return new Date();
    
    // Firestore Timestamp object
    if (typeof value.toDate === 'function') {
      return value.toDate();
    }
    
    // Firestore Timestamp proto format
    if (value._seconds !== undefined) {
      return new Date(value._seconds * 1000);
    }
    
    // Already a Date object
    if (value instanceof Date) {
      return value;
    }
    
    // ISO string or timestamp
    return new Date(value);
  }

  // ✅ FIX: Improved timestamp conversion
  toTimestamp(value) {
    if (!value) return 0;
    
    // Firestore Timestamp
    if (typeof value.toDate === 'function') {
      return value.toDate().getTime();
    }
    
    // Firestore proto format
    if (value._seconds !== undefined) {
      return value._seconds * 1000;
    }
    
    // Date object
    if (value instanceof Date) {
      return value.getTime();
    }
    
    // Fallback
    return new Date(value).getTime();
  }

  // ✅ FIX: Better date formatting
  formatEventDate(date) {
    try {
      // Ensure we have a valid Date object
      const d = date instanceof Date ? date : this.toDate(date);
      
      // Format for Nepal timezone (Asia/Kathmandu)
      return d.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kathmandu'
      });
    } catch (error) {
      console.error('Error formatting date:', error);
      return date.toString();
    }
  }
}

module.exports = new NotificationService();