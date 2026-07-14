---
id: fabacademy-final-project
type: project
title: Fab Academy Final Project
status: Complete
tags:
  - CH572D
  - DRV8835
  - 3D Printing
  - Wireless
date: '2025-06-15'
---

A wireless pan-tilt-zoom turret modeled after the "Evil Eye" camera from Rainbow Six Siege, featuring an infinitely rotatable base (360-degree range), internal battery power, and a fully 3D-printed enclosure.

### Core Systems
- **Turret Base & Pan-Tilt Head**: Parametrically modeled in Fusion 360 and printed in PETG/PLA. Geared stepper motors are used instead of traditional servos to provide high torque and true continuous infinite rotation.
- **Consolidated Driver Board**: A custom double-layer PCB featuring the **CH572D** BLE/wireless microcontroller and the **DRV8835** low-voltage dual stepper motor driver to control the pan/tilt movements.
- **USB Controller Dongle**: A custom USB-A dongle board featuring a second CH572D chip to transmit controls wirelessly.
- **Wireless Protocol**: A custom 2.4GHz packet protocol operating on channel 37 with magic packets for low-latency communication between the dongle and the turret.
- **Control Interface**: A web-based joystick interface that lets the user control the turret's rotation and orientation in real-time.

### Manufacturing Processes
- 3D parametric modeling (Fusion 360) and 3D printing (PETG/PLA)
- Structural finishing (sanding, priming, and painting)
- Schematic capture, PCB layout, and SMD reflow soldering/assembly
- Custom wireless firmware development using WCH's SDK
