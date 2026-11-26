# Mobile notifications

The mobile app does not send push notifications, Live Activities, Android Live Updates, or the
Agent Activity widget. Each of these was delivered through z9code's hosted relay, which this build
does not use, so nothing about your agents leaves your environment to reach your phone.

To follow work from your phone, connect to the environment directly over your local network,
Tailscale, or SSH (see [Remote access](./remote-access.md)) and open the thread. The app shows a
thread's progress while it is connected.
