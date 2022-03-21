# Empower4Life Signups

This repository provides a framework for hosting signups for Empower4Life
events. It uses AirTable as a backend for easy configuration and viewing, then
provides a server for the frontend for volunteers/donors to sign up for the
events.

## Backend

### Signups Table

The
[Signups Table](https://airtable.com/app087A4CurWjxse2/tbl7cueAnOMqVnxpk/viwKcpoXtRo6iiJ1b?blocks=hide)
is the place to setup a new event. Each event has the following properties:

- ID: auto-assigned identifier for this signup
- Title
- Description (optional)
- Image (optional)
- Active: checkbox specifying whether or not this signup is currently active
- Items: entries from the Items table for this event

### Users Table

The [Users Table](https://airtable.com/app087A4CurWjxse2/tbluy6a7DrTuTqCoR/viwcH4PXCQCnfkE6x?blocks=hide) is where all users that signup for any events/donations will be stored. Each user has the following properties:

- ID: auto-assigned identifier for this user
- First Name
- Last Name
- Email
- Phone (optional)
- Magic Code: generated secret key which can be sent to users to login to their account to modify their signups
- Items: entries from the Items table for which this user has signed up

### Items Table

The [Items Table](https://airtable.com/app087A4CurWjxse2/tblYCbwlZ5GwBZSVq/viwIqmIZu9HCnK28P?blocks=hide) is where all of the signup items are stored. For example, for a volunteer event, the individual jobs that need volunteers would be added to this table. For a donation signup, each item would be added to this table for donors to select from. Each item has the following properties:

- ID: auto-assigned identifier for this item
- Signup: event from the Signups table with which this item is associated
- Title
- Notes: details about the item which should be shown on the signup page
- Needed: the number of signups needed for this item
- Start time (optional): for volunteer events, this is the start time of the slot
- End time (optional): for volunteer events, this is the end time of the slot
- Users: entries from the Users table for users that have signed up for this item
- Active: whether this item is currently active (this is taken from the Signups table)

Note that the items are grouped by Signup. The default view ("Active Items") shows only active items, and the "All Items" view shows all of them.

## Frontend

There are two main user interfaces to the signups system.

First, is the event-specific signup page:
https://signups.empower4lifemd.org/event/<event-id>. The _event-id_ is a unique
number identifying an event, corresponding to the ID column in the Signups
table. This page shows the signup items for the specified event, with UI
elements for a user to signup.

The second main user interface page is a page for an individual volunteer/donor, available at https://signups.empower4lifemd.org/user/<user-id>. The _user-id_ is a unique number identifying a user, corresponding to the ID column in the Users table. This page shows all signups for the specified user and provides UI elements to cancel a signup.

The front page, https://signups.empower4lifemd.org, shows links to all active
signups. This link will not typically be shared, but instead the direct links to
individual signups will be shared.