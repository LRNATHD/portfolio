# Getting Started with the CH572

## Foreword
According to the datasheet, the CH572 was made "for 2.4G wireless communication applications and simple Bluetooth applications with low pin count"
This is nowhere near the full picture. this is one of the greatest microcontroller in existence. 

## Features 

### CH570 vs CH572
The only difference is that the 72 support BLE 5.0. This is solely due to the code being allowed to run on it, **if you are using the ch32fun library, there is <u> NO DIFFERENCE </u> between the 2 chips** <br>
## Useful Links

## Software

### Mounriver II

### CH32fun

## Uploading 

## Hardware
### Purchase Links
[Official Devboard](https://www.aliexpress.us/item/3256809002104895.html)
[Unofficial Devboard] (https://www.aliexpress.us/item/3256809238550420.html)





## Design Guidelines
Im (currently (2025) ) a high schooler with no formal pcb training outside of a real love of it and a want to learn more. I loved designing boards for the esp, and I seriously hope that this becomes my job one day. 
<br>

That being said, the CH572D is a pretty easy chip to design for. WCH are masters of making cheap chips that don't rely heavily on external components. The basics for this chip are a clock, a 1.5k resistor, and decoupling capacitors on the power input. While the chip says it support 5v or 3.3v, going with 5 severely limits its low power abilities, which are one of the selling points o fit


### First Devboard

### Example