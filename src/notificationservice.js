// ============================================================================
// FIXED notificationservice.js
// ============================================================================
const { getFirestore, getMessaging } = require('./firebase');
const cron = require('node-cron');

class NotificationService {
  constructor() {
    this.firestore = getFirestore();
    this.messaging = getMessaging();
    this.eventCache = new Map(); // Cache to track event changes
  }

  /* =========================================================
   * SEND TO ALL USERS (TOPIC)
   * =======================================================*/
  async sendToAll(title, body, data = {}) {
    try {
      const message = {
        notification: { title, body },
        data: {
          ...data,
          type: data.type || 'announcement',
          timestamp: new Date().toISOString(),
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'events_channel',
            sound: 'default',
            imageUrl: data.imageUrl || null,
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
          fcm_options: {
            image: data.imageUrl || null,
          },
        },
        topic: 'all_users',
      };

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
      console.error('❌ Error sending notification:', error);
      
      await this.firestore.collection('notification_errors').add({
        title,
        body,
        error: error.message,
        stack: error.stack,
        sentAt: new Date(),
      });
      
      throw error;
    }
  }

  /* =========================================================
   * NEW EVENT NOTIFICATION
   * =======================================================*/
  async sendNewEventNotification(event) {
    try {
      const eventDate = this.toDate(event.dateTime);
      const formattedDate = this.formatEventDate(eventDate);

      console.log(`📢 Sending NEW EVENT notification: ${event.title}`);

      await this.sendToAll(
        `🎉 New Event: ${event.title}`,
        `${formattedDate} • ${event.location}`,
        {
          type: 'new_event',
          eventId: event.id,
          route: 'events',
          imageUrl: event.imageUrl || '',
        }
      );

      // Save to event_notifications to track this event
      await this.firestore.collection('event_notifications').doc(event.id).set({
        eventId: event.id,
        eventTitle: event.title,
        type: 'new_event',
        lastNotifiedDate: event.dateTime,
        notifiedAt: new Date(),
      });

      console.log('✅ New event notification sent successfully');
    } catch (error) {
      console.error('❌ Error sending new event notification:', error);
    }
  }

  /* =========================================================
   * EVENT DATE MODIFIED NOTIFICATION
   * =======================================================*/
  async sendEventDateChangedNotification(event, oldDateTime, newDateTime) {
    try {
      const oldDate = this.toDate(oldDateTime);
      const newDate = this.toDate(newDateTime);
      
      const oldFormatted = this.formatEventDate(oldDate);
      const newFormatted = this.formatEventDate(newDate);

      console.log(`📅 Sending DATE CHANGED notification for: ${event.title}`);
      console.log(`   Old: ${oldFormatted}`);
      console.log(`   New: ${newFormatted}`);

      await this.sendToAll(
        `⏰ Event Rescheduled: ${event.title}`,
        `New Date: ${newFormatted}\nPrevious: ${oldFormatted}`,
        {
          type: 'event_rescheduled',
          eventId: event.id,
          route: 'events',
          imageUrl: event.imageUrl || '',
          oldDate: oldFormatted,
          newDate: newFormatted,
        }
      );

      // Update the tracked date
      await this.firestore.collection('event_notifications').doc(event.id).set({
        eventId: event.id,
        eventTitle: event.title,
        type: 'date_modified',
        lastNotifiedDate: event.dateTime,
        notifiedAt: new Date(),
        oldDate: oldDateTime,
        newDate: newDateTime,
      }, { merge: true });

      console.log('✅ Date changed notification sent successfully');
    } catch (error) {
      console.error('❌ Error sending date changed notification:', error);
    }
  }

  /* =========================================================
   * FIRESTORE EVENT LISTENER - FIXED VERSION
   * =======================================================*/
  startEventListener() {
    console.log('👂 Starting Firestore event listener...');

    const unsubscribe = this.firestore
      .collection('events')
      .onSnapshot(
        async (snapshot) => {
          console.log(`📊 Received ${snapshot.docChanges().length} changes`);

          for (const change of snapshot.docChanges()) {
            try {
              const event = { id: change.doc.id, ...change.doc.data() };
              
              // Skip inactive events or past events
              if (!event.isActive) {
                console.log(`⏭️  Skipping inactive event: ${event.title}`);
                continue;
              }

              const eventDate = this.toDate(event.dateTime);
              if (eventDate <= new Date()) {
                console.log(`⏭️  Skipping past event: ${event.title}`);
                continue;
              }

              /* ---------- NEW EVENT ---------- */
              if (change.type === 'added') {
                console.log(`🆕 New event detected: ${event.title}`);
                
                // Check if we already sent notification for this event
                const existingNotification = await this.firestore
                  .collection('event_notifications')
                  .doc(event.id)
                  .get();

                if (!existingNotification.exists) {
                  await this.sendNewEventNotification(event);
                  // Cache the event
                  this.eventCache.set(event.id, event.dateTime);
                } else {
                  console.log(`ℹ️  Already sent notification for: ${event.title}`);
                }
              }

              /* ---------- EVENT MODIFIED ---------- */
              if (change.type === 'modified') {
                console.log(`🔄 Event modified: ${event.title}`);

                // Get the previous notification record
                const notificationDoc = await this.firestore
                  .collection('event_notifications')
                  .doc(event.id)
                  .get();

                if (notificationDoc.exists) {
                  const lastNotifiedData = notificationDoc.data();
                  const oldDateTime = lastNotifiedData.lastNotifiedDate;
                  const newDateTime = event.dateTime;

                  // Compare timestamps properly
                  const oldTime = this.toTimestamp(oldDateTime);
                  const newTime = this.toTimestamp(newDateTime);

                  console.log(`   Old timestamp: ${oldTime}`);
                  console.log(`   New timestamp: ${newTime}`);

                  if (oldTime !== newTime) {
                    console.log('   ✅ Date changed! Sending notification...');
                    await this.sendEventDateChangedNotification(
                      event,
                      oldDateTime,
                      newDateTime
                    );
                  } else {
                    console.log('   ℹ️  Date unchanged, skipping notification');
                  }
                } else {
                  console.log(`   ⚠️  No previous notification record found`);
                }
              }

              /* ---------- EVENT DELETED ---------- */
              if (change.type === 'removed') {
                console.log(`🗑️  Event deleted: ${event.id}`);
                this.eventCache.delete(event.id);
              }

            } catch (error) {
              console.error('❌ Error processing event change:', error);
            }
          }
        },
        (error) => {
          console.error('❌ Snapshot listener error:', error);
          // Retry after 5 seconds
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
   * DAILY REMINDERS (CRON)
   * =======================================================*/
  scheduleDailyReminders() {
    console.log('⏰ Scheduling daily reminders for 9:00 AM...');

    cron.schedule(
      '0 9 * * *',
      async () => {
        console.log('🔔 Running daily reminder check...');
        
        try {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 2);
          tomorrow.setHours(0, 0, 0, 0);

          const snapshot = await this.firestore
            .collection('events')
            .where('isActive', '==', true)
            .get();

          const todayEvents = [];
          const tomorrowEvents = [];

          snapshot.forEach(doc => {
            const event = { id: doc.id, ...doc.data() };
            const eventDate = this.toDate(event.dateTime);
            eventDate.setHours(0, 0, 0, 0);

            if (eventDate.getTime() === now.getTime()) {
              todayEvents.push(event);
            } else if (eventDate.getTime() === (new Date(now.getTime() + 86400000)).getTime()) {
              tomorrowEvents.push(event);
            }
          });

          if (todayEvents.length > 0) {
            await this.sendToAll(
              `🔥 Events Today (${todayEvents.length})`,
              todayEvents.map(e => `• ${e.title}`).join('\n').substring(0, 100),
              { type: 'daily_reminder', route: 'events' }
            );
            console.log(`✅ Sent reminder for ${todayEvents.length} event(s) today`);
          }

          if (tomorrowEvents.length > 0) {
            await this.sendToAll(
              `📅 Tomorrow's Events (${tomorrowEvents.length})`,
              tomorrowEvents.map(e => `• ${e.title}`).join('\n').substring(0, 100),
              { type: 'daily_reminder', route: 'events' }
            );
            console.log(`✅ Sent reminder for ${tomorrowEvents.length} event(s) tomorrow`);
          }

          console.log('✅ Daily reminder check completed');
        } catch (error) {
          console.error('❌ Error in daily reminder:', error);
        }
      },
      { timezone: 'Asia/Kathmandu' }
    );

    console.log('✅ Daily reminder scheduled successfully');
  }

  /* =========================================================
   * MANUAL TRIGGER - Send notification for specific event
   * =======================================================*/
  async sendEventNotification(eventId) {
    try {
      console.log(`📢 Manual trigger for event: ${eventId}`);
      
      const eventDoc = await this.firestore
        .collection('events')
        .doc(eventId)
        .get();

      if (!eventDoc.exists) {
        throw new Error('Event not found');
      }

      const event = { id: eventDoc.id, ...eventDoc.data() };
      await this.sendNewEventNotification(event);

      return { success: true, message: 'Notification sent' };
    } catch (error) {
      console.error('❌ Error sending manual notification:', error);
      throw error;
    }
  }

  /* =========================================================
   * HELPERS
   * =======================================================*/
  toDate(value) {
    if (!value) return new Date();
    if (value.toDate) return value.toDate();
    if (value._seconds !== undefined) {
      return new Date(value._seconds * 1000);
    }
    return new Date(value);
  }

  toTimestamp(value) {
    if (!value) return 0;
    if (value.toDate) return value.toDate().getTime();
    if (value._seconds !== undefined) return value._seconds * 1000;
    if (value instanceof Date) return value.getTime();
    return new Date(value).getTime();
  }

  formatEventDate(date) {
    const options = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return date.toLocaleString('en-US', options);
  }

  async getStats() {
    try {
      const logsSnapshot = await this.firestore
        .collection('notification_logs')
        .orderBy('sentAt', 'desc')
        .limit(100)
        .get();

      const errorsSnapshot = await this.firestore
        .collection('notification_errors')
        .orderBy('sentAt', 'desc')
        .limit(100)
        .get();

      return {
        totalSent: logsSnapshot.size,
        totalErrors: errorsSnapshot.size,
        recentLogs: logsSnapshot.docs.slice(0, 10).map(doc => ({
          id: doc.id,
          ...doc.data(),
        })),
        recentErrors: errorsSnapshot.docs.slice(0, 10).map(doc => ({
          id: doc.id,
          ...doc.data(),
        })),
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      return { error: error.message };
    }
  }
}

module.exports = new NotificationService();