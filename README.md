# Guild Wars Party Bot
This is my newest project, the "Guild Wars Party Bot" (GWPB).
The GWPB serves as a party formation tracking bot that is specifically tailored to Guild Wars.
Future iterations of this bot may include other games if deemed necessary and if I have enough time.
The GWPB does not, in any way, interact with your Guild Wars client (Gw.exe); it is only a Discord bot.

## What is this?
Using the main command ``/formparty``, the discord user will be prompted to ``"Select the run type..."``. As of the time of writing, the following party formations can be created:
 - BogSC
 - DeepSC
 - DoASC
 - FoWSC
 - SoOSC
 - UrgozSC
 - UWSC

After selecting one of the options, a party will be created and users can react to reserve their spot as one of the selected roles.
Each role is predefined based on the current META for the respective Speed Clear area in-game. The META variations were selected based upon two factors:
  1) What the FBGM Wiki shows is META
  2) What's most commonly used in-game by players

Example: UrgozSC tactics that the bot uses are for Spikeway, not Skipway. Skipway may be faster, but more players in-game use Spikeway.

## Order of Operations
1) User executes ``/formparty`` in Discord server
2) User selects Speed Clear type from GWPB-prompted embed
3) GWPB performs a series of actions
   - Gets current date/time and labels the party with an ID for logging purposes
   - Creates party embed and lists the party as "Active" and starts a hidden timer
     - Timer is set for 3 hours. After 3 hours, the party embed auto locks but does not delete (for logging)
   - Sets command executing user to "Party Leader"
   - Creates ``Leave`` button and ``Claim Role`` button for users to Join/Leave the party
5) d
6) d
7) 

## Flowchart
**COMING SOON**

For now, just review the Order of Operations

## Update Roadmap
This section is where I'll be putting all of my future plans for the bot. This includes things that the community suggests to me.
