const { getFirestore, getMessaging } = require('./firebase');
const cron = require('node-cron');

class NotificationService {
  constructor() {
    this.firestore = getFirestore();
    this.messaging = getMessaging();
    this.eventListeners = new Map();
  }

  /**
   * Send notification to all users (topic)
   */
  async sendToAll(title, body, data = {}) {
    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: {
          ...data,
          type: 'announcement',
          timestamp: new Date().toISOString(),
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'events_channel',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
        topic: 'all_users',
      };

      const response = await this.messaging.send(message);

      // Log the notification
      await this.firestore.collection('notification_logs').add({
        title,
        body,
        data,
        type: 'manual',
        sentAt: new Date(),
        target: 'all_users',
        success: true,
        messageId:  response.messageId,
        sentBy: 'server',
      });

      return {
        success: true,
        messageId: response.messageId,
        response,
      };
    } catch (error) {
      console.error('❌ Error sending notification:', error);
      
      // Log error
      await this.firestore.collection('notification_errors').add({
        title,
        body,
        error: error.message,
        timestamp: new Date(),
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send notification to specific device token
   */
  async sendToDevice(token, title, body, data = {}) {
    try {
      const message = {
        notification: { title, body },
        data: {
          ...data,
          type: 'direct',
          timestamp: new Date().toISOString(),
        },
        token,
      };

      const response = await this.messaging.send(message);
      return {
        success: true,
        messageId: response.messageId,
      };
    } catch (error) {
      console.error('❌ Error sending to device:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send notification when new event is created
   */
  async sendNewEventNotification(event) {
    try {
      const eventDate = event.dateTime.toDate ? event.dateTime.toDate() : new Date(event.dateTime);
      const formattedDate = this.formatEventDate(eventDate);

      const message = {
        notification: {
          title: `🎉 New Event: ${event.title}`,
          body: `${formattedDate} • ${event.location}`,
        },
        data: {
          type: 'new_event',
          eventId: event.id || '',
          title: event.title,
          date: eventDate.toISOString(),
          location: event.location,
          route: '/events',
          image: event.imageUrl || '',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'events_channel',
            sound: 'default',
            imageUrl: event.imageUrl || null,
          },
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: `🎉 New Event: ${event.title}`,
                body: `${formattedDate} • ${event.location}`,
              },
              sound: 'default',
              badge: 1,
            },
          },
          fcm_options: {
            image: event.imageUrl || null,
          },
        },
        topic: 'all_users',
      };

      const response = await this.messaging.send(message);

      // Log successful notification
      await this.firestore.collection('notification_logs').add({
        eventId: event.id,
        eventTitle: event.title,
        type: 'new_event',
        sentAt: new Date(),
        target: 'all_users',
        success: true,
        messageId:response.messageId,
      });

      console.log(`✅ Notification sent for event: ${event.title}`);
      return response;
    } catch (error) {
      console.error(`❌ Error sending event notification:`, error);
      
      await this.firestore.collection('notification_errors').add({
        eventId: event.id,
        eventTitle: event.title,
        error: error.message,
        timestamp: new Date(),
      });
      
      throw error;
    }
  }

  /**
   * Start listening for new events in Firestore
   */
  startEventListener() {
    console.log('👂 Starting Firestore event listener...');

    // Listen to events collection
    const eventsRef = this.firestore.collection('events');
    
    eventsRef.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const event = {
            id: change.doc.id,
            ...change.doc.data(),
          };

          console.log(`🎯 New event detected: ${event.title}`);

          // Check if event is active and future
          if (event.isActive) {
            const eventDate = event.dateTime.toDate ? event.dateTime.toDate() : new Date(event.dateTime);
            if (eventDate > new Date()) {
              // Check if already notified
              const alreadyNotified = await this.checkIfAlreadyNotified(event.id);
              
              if (!alreadyNotified) {
                // Send notification
                await this.sendNewEventNotification(event);
                
                // Mark as notified
                await this.markAsNotified(event.id);
              }
            }
          }
        }
      });
    }, (error) => {
      console.error('❌ Firestore listener error:', error);
    });

    console.log('✅ Event listener started');
  }

  /**
   * Check if event already has a notification sent
   */
  async checkIfAlreadyNotified(eventId) {
    try {
      const snapshot = await this.firestore
        .collection('notification_logs')
        .where('eventId', '==', eventId)
        .where('type', '==', 'new_event')
        .limit(1)
        .get();
      
      return !snapshot.empty;
    } catch (error) {
      console.error('Error checking notification status:', error);
      return false;
    }
  }

  /**
   * Mark event as notified
   */
  async markAsNotified(eventId) {
    try {
      await this.firestore.collection('event_notifications').add({
        eventId,
        notifiedAt: new Date(),
        type: 'auto',
      });
    } catch (error) {
      console.error('Error marking as notified:', error);
    }
  }

  /**
   * Schedule daily event reminders
   */
  scheduleDailyReminders() {
    // Run at 9 AM every day (Asia/Kathmandu time)
    cron.schedule('0 9 * * *', async () => {
      console.log('📅 Running daily event reminder check...');
      
      try {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Get events happening today
        const todaysEvents = await this.firestore
          .collection('events')
          .where('dateTime', '>=', today)
          .where('dateTime', '<', tomorrow)
          .where('isActive', '==', true)
          .get();
        
        if (!todaysEvents.empty) {
          const eventCount = todaysEvents.size;
          const firstEvent = todaysEvents.docs[0].data();
          
          await this.sendToAll(
            `📅 Today's Events (${eventCount})`,
            `You have ${eventCount} event(s) today. First: ${firstEvent.title}`,
            {
              type: 'daily_digest',
              eventCount: eventCount.toString(),
              route: '/events',
            }
          );
          
          console.log(`✅ Daily digest sent for ${eventCount} events`);
        }
      } catch (error) {
        console.error('❌ Error sending daily digest:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Kathmandu"
    });

    console.log('✅ Daily reminders scheduled');
  }

  /**
   * Format date helper
   */
  formatEventDate(date) {
    const options = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return date.toLocaleDateString('en-US', options);
  }

  /**
   * Get notification statistics
   */
  async getStats() {
    try {
      const [
        totalNotifications,
        successCount,
        errorCount,
        recentNotifications
      ] = await Promise.all([
        this.firestore.collection('notification_logs').count().get(),
        this.firestore.collection('notification_logs')
          .where('success', '==', true).count().get(),
        this.firestore.collection('notification_errors').count().get(),
        this.firestore.collection('notification_logs')
          .orderBy('sentAt', 'desc')
          .limit(10)
          .get(),
      ]);

      return {
        total: totalNotifications.data().count,
        successful: successCount.data().count,
        errors: errorCount.data().count,
        successRate: totalNotifications.data().count > 0 
          ? (successCount.data().count / totalNotifications.data().count * 100).toFixed(1)
          : 0,
        recent: recentNotifications.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          sentAt: doc.data().sentAt?.toDate()?.toISOString(),
        })),
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      throw error;
    }
  }
}

module.exports = new NotificationService();