/**
 * Pusher Mock for Testing
 *
 * Provides mock implementations for Pusher server and client
 * to enable testing of real-time functionality without actual connections.
 */

/**
 * Interface for triggered events
 */
interface TriggeredEvent {
  channel: string;
  event: string;
  data: unknown;
  timestamp: Date;
}

/**
 * Mock Pusher Server
 *
 * Tracks all triggered events for assertions.
 */
class MockPusherServer {
  private triggeredEvents: TriggeredEvent[] = [];
  private isConnected: boolean = true;

  /**
   * Trigger an event on a channel
   */
  async trigger(channel: string | string[], event: string, data: unknown): Promise<void> {
    if (!this.isConnected) throw new Error('Pusher is not connected');

    const channels = Array.isArray(channel) ? channel : [channel];

    for (const ch of channels)
      this.triggeredEvents.push({
        channel: ch,
        event,
        data,
        timestamp: new Date(),
      });
  }

  /**
   * Get all triggered events
   */
  getTriggeredEvents(): TriggeredEvent[] {
    return [...this.triggeredEvents];
  }

  /**
   * Get events for a specific channel
   */
  getEventsForChannel(channel: string): TriggeredEvent[] {
    return this.triggeredEvents.filter(e => e.channel === channel);
  }

  /**
   * Get events of a specific type
   */
  getEventsByType(event: string): TriggeredEvent[] {
    return this.triggeredEvents.filter(e => e.event === event);
  }

  /**
   * Clear all triggered events
   */
  clearEvents(): void {
    this.triggeredEvents = [];
  }

  /**
   * Simulate connection state
   */
  setConnected(connected: boolean): void {
    this.isConnected = connected;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

/**
 * Interface for channel subscription
 */
interface ChannelSubscription {
  channel: string;
  callbacks: Map<string, Array<(data: unknown) => void>>;
}

/**
 * Mock Pusher Client
 *
 * Simulates client-side Pusher functionality.
 */
class MockPusherClient {
  private subscriptions: Map<string, ChannelSubscription> = new Map();
  private isConnected: boolean = true;

  /**
   * Subscribe to a channel
   */
  subscribe(channelName: string): MockChannel {
    if (!this.subscriptions.has(channelName))
      this.subscriptions.set(channelName, {
        channel: channelName,
        callbacks: new Map(),
      });

    return new MockChannel(channelName, this.subscriptions.get(channelName)!.callbacks);
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName: string): void {
    this.subscriptions.delete(channelName);
  }

  /**
   * Simulate receiving an event (for testing)
   */
  simulateEvent(channel: string, event: string, data: unknown): void {
    const subscription = this.subscriptions.get(channel);
    if (subscription) {
      const callbacks = subscription.callbacks.get(event);
      if (callbacks) callbacks.forEach(cb => cb(data));
    }
  }

  /**
   * Get all subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Check if subscribed to a channel
   */
  isSubscribed(channelName: string): boolean {
    return this.subscriptions.has(channelName);
  }

  /**
   * Disconnect (mock)
   */
  disconnect(): void {
    this.isConnected = false;
    this.subscriptions.clear();
  }

  /**
   * Connect (mock)
   */
  connect(): void {
    this.isConnected = true;
  }

  /**
   * Get connection state
   */
  get connection(): { state: string } {
    return {
      state: this.isConnected ? 'connected' : 'disconnected',
    };
  }
}

/**
 * Mock Channel
 *
 * Represents a subscribed channel.
 */
class MockChannel {
  constructor(
    private channelName: string,
    private callbacks: Map<string, Array<(data: unknown) => void>>
  ) {}

  /**
   * Bind a callback to an event
   */
  bind(event: string, callback: (data: unknown) => void): this {
    if (!this.callbacks.has(event)) this.callbacks.set(event, []);

    this.callbacks.get(event)!.push(callback);
    return this;
  }

  /**
   * Unbind a callback from an event
   */
  unbind(event: string, callback?: (data: unknown) => void): this {
    if (!callback) this.callbacks.delete(event);
    else {
      const callbacks = this.callbacks.get(event);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) callbacks.splice(index, 1);
      }
    }
    return this;
  }

  /**
   * Trigger an event locally (for testing)
   */
  emit(event: string, data: unknown): void {
    const callbacks = this.callbacks.get(event);
    if (callbacks) callbacks.forEach(cb => cb(data));
  }

  /**
   * Get channel name
   */
  get name(): string {
    return this.channelName;
  }
}

// Create singleton instances for tests
let mockPusherServer: MockPusherServer | null = null;
let mockPusherClient: MockPusherClient | null = null;

/**
 * Get mock Pusher server instance
 */
export function getMockPusherServer(): MockPusherServer {
  if (!mockPusherServer) mockPusherServer = new MockPusherServer();

  return mockPusherServer;
}

/**
 * Get mock Pusher client instance
 */
export function getMockPusherClient(): MockPusherClient {
  if (!mockPusherClient) mockPusherClient = new MockPusherClient();

  return mockPusherClient;
}

/**
 * Reset all mocks
 */
export function resetPusherMocks(): void {
  if (mockPusherServer) {
    mockPusherServer.clearEvents();
    mockPusherServer.setConnected(true);
  }
  if (mockPusherClient) {
    mockPusherClient.disconnect();
    mockPusherClient.connect();
  }
}

/**
 * Create fresh mock instances (for isolated tests)
 */
export function createFreshMocks(): {
  server: MockPusherServer;
  client: MockPusherClient;
} {
  return {
    server: new MockPusherServer(),
    client: new MockPusherClient(),
  };
}

export { MockPusherServer, MockPusherClient, MockChannel };
export type { TriggeredEvent, ChannelSubscription };
