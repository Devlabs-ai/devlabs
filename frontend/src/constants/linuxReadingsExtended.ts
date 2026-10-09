/** Linux track readings B3–B13 (labs 05+). Each post stands alone with its own story. */

import type { K8sReading } from './k8sReadings';

export const LINUX_READINGS_EXTENDED: K8sReading[] = [
  {
    id: 'pipes-and-pipelines',
    slug: 'pipes-and-pipelines',
    trackId: 'B3',
    eyebrow: 'Connect small tools',
    title: 'Pipes and Pipelines: sort, uniq, wc, cut, awk',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-05-pipeline-for-the-daily-order-report',
    lede:
      'When a file has thousands of lines, you still need **totals**, **top sellers**, and **counts** — not eye strain. This post uses a **camp snack store** ledger to show **pipes**: small tools wired with **`|`** so the computer does the scrolling.',
    sections: [
      {
        id: 'camp-snack-story',
        title: 'Camp snack store',
        body: [
          'A **summer camp** runs a small **snack store** — a hut beside the dining hall where campers buy **drinks, granola bars, and fruit cups** (not clothes or gear). You volunteer on the desk. Each purchase is logged on a **Linux PC** in the camp office.',
          'Every sale appends one line to **`snacks.csv`**: date, cabin, snack name, **successful** or **failed**, and price in cents. By mid-morning the file already has thousands of lines.',
          'The director bets you a tray of ice bars if you can name the **top three best-selling snacks** (successful sales only) before the lunch rush. You will not read every row by hand — you **chain** commands: keep successful rows, grab the snack column, **sort**, **count**, show the top three.',
        ],
        code: {
          language: 'csv',
          filename: 'snacks.csv',
          code: `date,cabin,snack,status,cents
2026-07-04,Pine-7,Iced tea,successful,150
2026-07-04,Maple-2,Granola bar,successful,200
2026-07-04,Pine-7,Granola bar,successful,200
2026-07-04,Oak-1,Iced tea,failed,150`,
        },
      },
      {
        id: 'manual-vs-tools',
        title: 'Why not just read the whole file?',
        body: [
          'One approach is to open **`snacks.csv`** in an editor or **`less`**, scan line by line, and keep a tally in your head — or copy rows into a spreadsheet — to compute **top sellers**, **failed-sale counts**, or **total cents** for the day.',
          'That works for twenty lines. It falls apart at twenty **thousand**. You miscount when a camper buys two granola bars in a row, you forget to skip the failed ones, and you lose an hour you do not have before lunch.',
          'What you really want is to hand the boring part to the computer: **throw away** rows you do not care about, **keep** just the column you need, then **count** or **add up** what is left. Linux has small tools for each of those steps, plus a simple way to **connect** them. The next two sections cover both.',
        ],
        table: {
          headers: ['Question about the ledger', 'Doing it by hand'],
          rows: [
            ['Top 3 snacks (successful only)', 'Scroll, skip failed sales, tally every snack name'],
            ['How many sales failed today?', 'Count failed rows while scrolling'],
            ['Total cents from successful sales', 'Copy the cents column into a spreadsheet and add it up'],
          ],
        },
      },
      {
        id: 'pipe-mechanics',
        title: 'What is a pipe?',
        body: [
          'A **pipe** is the **`|`** between two commands. The output of the left command becomes the input of the right one — no temporary files needed.',
          'Only normal output (**stdout**) flows through. Errors (**stderr**) still print on your screen, which is why a typo in the first command shows up even when the rest of the pipe prints nothing.',
        ],
        table: {
          headers: ['Piece', 'Meaning'],
          rows: [
            ['`|`', 'Send the left command’s output into the right command'],
            ['stdout', 'Normal output — flows through the pipe'],
            ['stdin', 'Where the right-hand command reads from'],
            ['stderr', 'Errors — stays on the screen'],
          ],
        },
      },
      {
        id: 'question-to-pipeline',
        title: 'From the director’s question to one command',
        body: [
          '**“Which three snacks sold the most today — successful sales only?”** Each step you would do by hand has a tool:',
        ],
        bullets: [
          'Keep only the successful lines → **`grep`**',
          'Look only at the snack name → **`cut`**',
          'Group identical names together → **`sort`**',
          'Count each group → **`uniq -c`**',
          'Rank biggest first → **`sort -rn`**',
          'Take the top three → **`head`**',
        ],
        codes: [
          {
            language: 'shell',
            code: `grep ',successful,' snacks.csv | cut -d, -f3 | sort | uniq -c | sort -rn | head -3`,
          },
        ],
        after: [
          'Same six steps, joined with **`|`**. The next section looks at each tool on its own.',
        ],
      },
      {
        id: 'filter-tools',
        title: 'Filters: tools that fit in a pipe',
        body: [
          'A **filter** is a command that reads **text in**, changes it, and prints **text out** — which is exactly what a pipe needs. Most filters accept a **file name**, but when they sit on the right side of **`|`** they read from stdin instead. Here are the ones from the snack pipe, in the order they ran.',
        ],
        subsections: [
          {
            id: 'grep',
            title: 'grep: keep the lines you want',
            body: [
              '**`grep`** prints every line that contains a pattern and silently drops the rest. It does not change the lines — it only decides which ones survive.',
              'Include the commas around **`successful`** so it only matches the status column, not a snack that happens to contain the word. **`-v`** flips the match; **`-i`** ignores upper/lower case.',
            ],
            code: {
              language: 'shell',
              code: `# Keep successful sales (drops failed ones and the header)
grep ',successful,' snacks.csv

# Everything except failed sales
grep -v ',failed,' snacks.csv`,
            },
          },
          {
            id: 'cut',
            title: 'cut: keep the columns you want',
            body: [
              '**`cut`** works on each line separately. **`-d,`** says columns are separated by commas, and **`-f`** picks which columns to print.',
              'It is simple: it does not understand quoted CSV fields with commas inside them, so it fits clean files like this ledger best.',
            ],
            code: {
              language: 'shell',
              code: `# Snack name only (column 3)
cut -d, -f3 snacks.csv

# Cabin and snack (columns 2 and 3)
cut -d, -f2,3 snacks.csv`,
            },
          },
          {
            id: 'sort',
            title: 'sort: put lines in order',
            body: [
              '**`sort`** prints its input lines back in order — alphabetical by default. In the snack pipe its real job is **grouping**: after sorting, identical names sit next to each other.',
              '**`-n`** sorts by number (so 10 comes after 9, not after 1), **`-r`** reverses the order, and **`-u`** drops duplicates.',
            ],
            code: {
              language: 'shell',
              code: `# Alphabetical snack names
cut -d, -f3 snacks.csv | sort

# Unique snack names
cut -d, -f3 snacks.csv | sort -u

# Numbers, biggest first
sort -rn`,
            },
          },
          {
            id: 'uniq',
            title: 'uniq: collapse and count repeats',
            body: [
              '**`uniq`** merges **neighbouring** identical lines into one. With **`-c`** it writes how many there were in front, so three Granola bar lines in a row become one line with a 3.',
              'It only compares a line with the one right above it, so duplicates far apart are counted separately. That is why **`sort`** always comes right before **`uniq -c`**.',
            ],
            code: {
              language: 'shell',
              code: `# Count each snack (sort first so duplicates touch)
cut -d, -f3 snacks.csv | sort | uniq -c`,
            },
          },
          {
            id: 'head',
            title: 'head: keep only the first few lines',
            body: [
              '**`head`** prints the first few lines and stops — ten by default, or as many as you ask with **`-N`**. Its partner **`tail`** prints the last few instead.',
              'It is also handy while building a pipe: put it at the end to peek at a sample instead of thousands of lines.',
            ],
            code: {
              language: 'shell',
              code: `# First 3 lines of a ranked list
... | sort -rn | head -3

# Peek at the first 10 lines of the ledger
head snacks.csv`,
            },
          },
          {
            id: 'wc-and-awk',
            title: 'Two more: wc and awk',
            body: [
              '**`wc -l`** counts lines — put it at the end of a pipe to answer “how many?”.',
              '**`awk`** can pick rows, pick columns, and do math in one command. Here it skips the header, keeps successful rows, adds up column 5 (cents), and prints the total.',
            ],
            code: {
              language: 'shell',
              code: `# How many failed sales?
grep ',failed,' snacks.csv | wc -l

# Total cents from successful sales
awk -F, 'NR>1 && $4=="successful" {sum += $5} END {print sum}' snacks.csv`,
            },
          },
        ],
        callout: {
          kind: 'tip',
          title: 'Debug a pipeline from the left',
          body: [
            'Run only the first command. Add **`| head`** after each new stage so you see a **sample** before the full result flies by. Fix **`grep`** before you blame **`uniq`**. ',
          ],
        },
      },
      {
        id: 'win-the-bet',
        title: 'Win the bet: top three snacks',
        body: [
          'Now go back to the three questions from earlier. Each one becomes a single command line built from the pipe and filters above.',
          'Columns in **`snacks.csv`**: **`date`**, **`cabin`**, **`snack`**, **`status`**, **`cents`**. For the top three: successful rows only, then snack names, sort so duplicates touch, count, sort by count, take three.',
        ],
        table: {
          headers: ['Question about the ledger', 'Doing it by hand', 'Pipeline'],
          rows: [
            ['Top 3 snacks (successful only)', 'Scroll and tally', '`grep` → `cut` → `sort` → `uniq -c` → `sort -rn` → `head`'],
            ['How many sales failed today?', 'Count while scrolling', '`grep failed | wc -l`'],
            ['Total cents from successful sales', 'Add in a spreadsheet', '`awk` sum on the cents column'],
          ],
        },
        code: {
          language: 'shell',
          code: `# Preview successful rows
grep ',successful,' snacks.csv | head

# Top 3 snacks
grep ',successful,' snacks.csv | cut -d, -f3 | sort | uniq -c | sort -rn | head -3

# Failed sale count
grep ',failed,' snacks.csv | wc -l

# Total cents from successful sales (awk reads the file directly)
awk -F, 'NR>1 && $4=="successful" {sum += $5} END {print sum}' snacks.csv`,
        },
      },
      {
        id: 'quick-reference',
        title: 'Quick reference',
        body: [
          'Match the **question** to a **shape**: narrow lines → transform columns → order → count → trim. Sums often live in **`awk`** without a long pipe.',
        ],
        tableAfter: {
          headers: ['Goal', 'Shape of the pipeline'],
          rows: [
            ['Count matching lines', '`grep pattern file | wc -l`'],
            ['Unique values', '`cut ... | sort -u`'],
            ['Top N counts', "`grep ... | cut ... | sort | uniq -c | sort -rn | head -N`"],
            ['Sum a numeric column', '`awk -F, \'... {sum+=$col} END {print sum}\' file`'],
          ],
        },
      },
    ],
    takeaways: [
      'Scrolling huge logs to compute **top N**, **counts**, or **sums** is slow and error-prone — use **filters** instead.',
      '**`|`** connects **stdout → stdin**; read pipelines **left to right**, one job per command.',
      '**`grep`** narrows lines; **`cut`** picks columns; **`sort`** + **`uniq -c`** count repeats; **`head`** / **`wc -l`** finish the answer.',
      '**`awk`** handles conditions and **totals**; debug by running the **leftmost** commands first and adding **`| head`**. ',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      {
        challengeId: 'linux-05-pipeline-for-the-daily-order-report',
        label: 'Pipeline for the Daily Order Report',
      },
    ],
  },
  {
    id: 'users-groups-and-permissions',
    slug: 'users-groups-and-permissions',
    trackId: 'B4',
    eyebrow: 'Who can touch what',
    title: 'Users, Groups, and Permissions',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-07-onboard-the-payments-team',
    lede:
      'Linux is **multi-user**: many people and programs share one machine, so every file records **who owns it** and **who may read, change, or run it**. This post covers the pieces in order — **users and groups**, **permission bits**, how to **change** them, and **ACLs** for the exceptions.',
    sections: [
      {
        id: 'identity',
        title: 'Users and groups: who you are',
        body: [
          'Every person — and many programs, like a web server — runs as a **user**. A **group** is a named set of users, so you can give a whole team access at once instead of one person at a time. Every file belongs to exactly **one user** and **one group**.',
        ],
        subsections: [
          {
            id: 'whoami-id',
            title: 'whoami and id: check who you are',
            body: [
              '**`whoami`** prints your user name. **`id`** shows more: your numeric user id (**uid**), your main group (**gid**), and every group you belong to. Linux checks the numbers, not the names — names are just labels for people.',
            ],
            code: {
              language: 'shell',
              code: `whoami   # asha
id       # uid=1001(asha) gid=1001(asha) groups=1001(asha),1002(developers)
id ravi  # same, for another user`,
            },
          },
          {
            id: 'passwd-group-files',
            title: '/etc/passwd and /etc/group: where accounts live',
            body: [
              'Accounts are stored in two plain text files, one line per account, with fields separated by colons. Anyone can read them; only root can change them.',
              '**`/etc/passwd`** has seven fields per user: **name**, **x** (a placeholder — the real password hash lives in **`/etc/shadow`**, which only root can read), **uid**, **gid** of the user’s main group, a **comment** (often the full name), the **home folder**, and the **login shell**. Service accounts such as **`www-data`** usually have a uid below 1000 and the shell **`/usr/sbin/nologin`**, so nobody can log in as them.',
              '**`/etc/group`** has four fields per group: **name**, **x**, **gid**, and a comma-separated list of **members**. That list only shows people who joined as an extra group — a user’s main group comes from the gid in **`/etc/passwd`**. **`getent`** looks up either file by name, which is handy on systems where accounts also come from a directory service.',
            ],
            code: {
              language: 'shell',
              code: `grep asha /etc/passwd       # asha:x:1001:1001:Asha Rao:/home/asha:/bin/bash
grep www-data /etc/passwd   # www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
grep developers /etc/group  # developers:x:1002:asha,ravi
getent passwd ravi          # look up one user
getent group developers     # look up one group`,
            },
          },
          {
            id: 'root-sudo',
            title: 'root and sudo: the all-powerful account',
            body: [
              '**root** (uid **0**) is the administrator account: permission checks do not apply to it, so it can read, change, or delete anything. Creating users, editing system files, and giving files away all need root.',
              'Instead of logging in as root, you put **`sudo`** in front of a single command. It asks for **your** password, checks that you are allowed to use it, and runs just that one command as root. Every command in the next three subsections starts with **`sudo`** for this reason.',
            ],
            code: {
              language: 'shell',
              code: `sudo cat /etc/shadow  # read a root-only file
sudo -l               # what am I allowed to run with sudo?
sudo -u ravi whoami   # run a command as another user: ravi`,
            },
          },
          {
            id: 'useradd',
            title: 'useradd: create a user',
            body: [
              '**`useradd`** creates a new account: it adds a line to **`/etc/passwd`**, picks the next free uid, and usually creates a main group with the same name. On its own it does very little else — no home folder on many systems and no password — so a few flags are almost always added.',
              'The new user cannot log in until you set a password with **`passwd`**. To remove an account later, use **`userdel`** (add **`-r`** to delete the home folder too).',
            ],
            code: {
              language: 'shell',
              code: `sudo useradd -m ravi                  # -m: also create /home/ravi
sudo useradd -m -s /bin/bash ravi     # -s: choose the login shell
sudo useradd -m -c 'Ravi Kumar' ravi  # -c: full name in the comment field
sudo useradd -m -G developers ravi    # -G: extra groups to join right away
sudo passwd ravi                      # set a password so ravi can log in
sudo userdel -r ravi                  # delete ravi and the home folder`,
            },
          },
          {
            id: 'groupadd',
            title: 'groupadd: create a group',
            body: [
              '**`groupadd`** creates a new, empty group by adding a line to **`/etc/group`**. Create one group per team or role — **developers**, **backups**, **payments** — and grant access to the group instead of to individual people.',
              'Use **`-g`** if the group must have a specific gid (for example, to match another server), and **`groupdel`** to remove a group nobody uses any more.',
            ],
            code: {
              language: 'shell',
              code: `sudo groupadd developers       # create the group
sudo groupadd -g 1500 backups  # -g: choose the gid yourself
getent group developers        # check it: developers:x:1002:
sudo groupdel backups          # remove a group`,
            },
          },
          {
            id: 'usermod',
            title: 'usermod: change an existing user',
            body: [
              '**`usermod`** changes an account that already exists. Its most common job is adding someone to a group with **`-aG`**. The **`-a`** (append) is essential: **`-G`** on its own **replaces** the user’s whole list of extra groups, silently removing them from every other group.',
              'Group changes apply to **new** logins. After adding yourself to a group, log out and back in (or open a new SSH session) before **`id`** shows it. To take someone out of a group, use **`gpasswd -d`**.',
            ],
            code: {
              language: 'shell',
              code: `sudo usermod -aG developers ravi  # add ravi to developers, keep other groups
sudo usermod -s /bin/zsh ravi     # -s: change the login shell
sudo usermod -L ravi              # -L: lock the account (no password logins)
sudo usermod -U ravi              # -U: unlock it again
sudo gpasswd -d ravi developers   # remove ravi from developers
id ravi                           # check the result`,
            },
          },
        ],
        table: {
          headers: ['Command', 'What it does'],
          rows: [
            ['`whoami` / `id`', 'Show your user name / uid, gid, and groups'],
            ['`/etc/passwd` / `/etc/group`', 'Text files listing users / groups and members'],
            ['`sudo command`', 'Run one command as root'],
            ['`useradd -m user`', 'Create a user with a home folder'],
            ['`passwd user`', 'Set a user’s password'],
            ['`groupadd group`', 'Create a group'],
            ['`usermod -aG group user`', 'Add a user to a group'],
            ['`gpasswd -d user group`', 'Remove a user from a group'],
          ],
        },
      },
      {
        id: 'permission-bits',
        title: 'Permissions: reading ls -l',
        body: [
          'Every file carries three sets of permissions: one for its **user** (owner), one for its **group**, and one for **others** — everyone else. **`ls -l`** shows them at the start of each line.',
        ],
        subsections: [
          {
            id: 'read-ls-l',
            title: 'Run ls -l',
            body: [
              '**`ls -l`** (long listing) prints one line per file with its permissions, owner, group, size, and date. Add **`-d`** to see a folder itself rather than what is inside it.',
            ],
            code: {
              language: 'shell',
              code: `$ ls -l notes.txt
-rw-r----- 1 asha developers 1204 Oct  4 09:15 notes.txt`,
            },
          },
          {
            id: 'ls-l-parts',
            title: 'What each part of the line means',
            body: [
              'Read the line from left to right. The very first character is the **type** of the entry. The next **nine** characters are the permissions, in three groups of three: first for the **owner**, then for the **group**, then for **others**. In each group the positions are always **read**, **write**, **execute** — a letter means allowed, a dash means not.',
              'Then come the owner and group names, so you can tell **who** each group of three applies to. In this example, asha can read and edit the file, members of developers can read it, and everyone else cannot open it at all.',
            ],
            code: {
              language: 'text',
              code: `-            type: - file, d directory, l link
rw-          owner (asha) can read and write
r--          group (developers) can only read
---          others can do nothing
1            number of links (ignore for now)
asha         owner
developers   group
1204         size in bytes
Oct  4 09:15 last modified
notes.txt    name`,
            },
          },
          {
            id: 'rwx-meaning',
            title: 'r, w, x on files and on directories',
            body: [
              'On a **file** the letters mean what you expect: **r** read the contents, **w** change them, **x** run it as a program or script.',
              'On a **directory** they mean something slightly different: **r** lets you **list** the names inside, **w** lets you **create, rename, or delete** files in it, and **x** lets you **enter** it (**`cd`**) and reach the files inside. A folder with **r** but no **x** shows names you cannot open; that is why folders almost always get **x** together with **r**.',
            ],
          },
          {
            id: 'octal',
            title: 'Permissions as numbers',
            body: [
              'Each permission letter has a value: **r = 4**, **w = 2**, **x = 1**, and a dash is **0**. To turn a set of three letters into one digit, add up the values of the letters that are present. Do that for owner, group, and others, and you get a three-digit number.',
              'Example: **`rwxr-x---`**. Owner **`rwx`** = 4 + 2 + 1 = **7**. Group **`r-x`** = 4 + 0 + 1 = **5**. Others **`---`** = **0**. The number is **750**. The block below works through a few more.',
              'Going the other way works the same: split the number into digits and break each one back into 4, 2, and 1. **640** → 6 = 4 + 2 = **`rw-`**, 4 = **`r--`**, 0 = **`---`**, so **`rw-r-----`**. Because 4, 2, and 1 never overlap, every digit from 0 to 7 has exactly one meaning.',
              'A handful of numbers cover most cases: **644** for normal files, **600** for private files like keys, **755** for programs and public folders, **700** for private folders, **770** for team folders. **`stat`** prints a file’s number directly.',
            ],
            code: {
              language: 'text',
              code: `permissions   owner      group      others     number
rwxr-xr-x     rwx 4+2+1  r-x 4+0+1  r-x 4+0+1  755
rw-r--r--     rw- 4+2+0  r-- 4+0+0  r-- 4+0+0  644
rwxr-x---     rwx 4+2+1  r-x 4+0+1  --- 0+0+0  750
rw-------     rw- 4+2+0  --- 0+0+0  --- 0+0+0  600`,
            },
          },
        ],
        table: {
          headers: ['Letter', 'Value', 'On a file', 'On a directory'],
          rows: [
            ['`r`', '4', 'Read the contents', 'List the names inside'],
            ['`w`', '2', 'Change the contents', 'Create, rename, delete files inside'],
            ['`x`', '1', 'Run it as a program', 'Enter it and reach files inside'],
          ],
        },
      },
      {
        id: 'changing-permissions',
        title: 'Changing access: chmod, chown, chgrp',
        body: [
          'Three commands change who can do what. Only the file’s owner (or root) can change its permissions, and only root can give a file to another user.',
        ],
        subsections: [
          {
            id: 'chmod-symbolic',
            title: 'chmod with letters',
            body: [
              '**`chmod`** changes permission bits. The letter form reads like a sentence: **who** (**`u`** user, **`g`** group, **`o`** others, **`a`** all), then **`+`** add, **`-`** remove, or **`=`** set exactly, then **which** permissions.',
            ],
            code: {
              language: 'shell',
              code: `chmod u+x deploy.sh          # let the owner run it
chmod g+w notes.txt          # let the group edit it
chmod o-rwx notes.txt        # take everything away from others
chmod u=rw,g=r,o= notes.txt  # set all three exactly`,
            },
          },
          {
            id: 'chmod-octal',
            title: 'chmod with numbers',
            body: [
              'The number form sets all nine bits at once, using the values from the previous section. It is shorter when you know the end result you want. Add **`-R`** to apply a change to a folder and everything inside it — carefully, since files and folders usually need different bits.',
            ],
            code: {
              language: 'shell',
              code: `chmod 640 notes.txt          # rw- r-- ---
chmod 600 ~/.ssh/id_ed25519  # private key: owner only
chmod 755 deploy.sh          # everyone can run, only owner can edit
chmod 770 /srv/team          # team folder: owner and group only`,
            },
          },
          {
            id: 'chown-chgrp',
            title: 'chown and chgrp: change owner and group',
            body: [
              '**`chown user file`** gives a file to another user; **`chown user:group file`** sets both at once. **`chgrp group file`** changes only the group. Giving files away needs **`sudo`**; changing the group works without it if you are a member of the new group.',
            ],
            code: {
              language: 'shell',
              code: `sudo chown ravi report.txt               # ravi now owns it
sudo chown ravi:developers report.txt    # owner and group together
chgrp developers notes.txt               # group only
sudo chown -R ravi:developers /srv/team  # a whole folder tree`,
            },
          },
        ],
        table: {
          headers: ['Command', 'Changes', 'Example'],
          rows: [
            ['`chmod` (letters)', 'Add or remove specific bits', '`chmod g+w file`'],
            ['`chmod` (numbers)', 'Set all bits at once', '`chmod 640 file`'],
            ['`chown`', 'Owner, or owner and group', '`chown ravi:developers file`'],
            ['`chgrp`', 'Group only', '`chgrp developers file`'],
          ],
        },
      },
      {
        id: 'shared-folders',
        title: 'Shared team folders: group + setgid',
        body: [
          'A common task: a folder the whole **developers** group can work in, closed to everyone else. Give the folder to the group and set **770**.',
          'One problem remains: a new file normally gets its creator’s own group, so teammates may not be able to edit it. The **setgid** bit on the folder (**`chmod g+s`**, or the leading **2** in **2770**) fixes that — every new file inside inherits the folder’s group. In **`ls -l`** it shows as an **`s`** in the group’s **x** spot.',
        ],
        code: {
          language: 'shell',
          code: `sudo mkdir /srv/team             # create the folder
sudo chgrp developers /srv/team  # folder belongs to the team
sudo chmod 2770 /srv/team        # rwx for owner and group, setgid on
ls -ld /srv/team                 # drwxrws--- root developers /srv/team`,
        },
      },
      {
        id: 'acls',
        title: 'ACLs: exceptions for one person',
        body: [
          'Owner, group, and others cover most needs. When one extra person needs access — without adding them to the whole group or opening the file to everyone — use an **ACL** (access control list): an extra rule attached to the file for a specific user or group.',
          '**`setfacl -m`** adds a rule, **`getfacl`** shows all rules, and **`setfacl -x`** removes one. A file with ACLs shows a **`+`** at the end of its permissions in **`ls -l`**, which is your hint to run **`getfacl`**.',
        ],
        code: {
          language: 'shell',
          code: `setfacl -m u:ravi:r report.txt  # ravi may read, nothing else changes
getfacl report.txt              # list owner, group, others, and extra rules
ls -l report.txt                # -rw-r-----+  (the + means: has ACLs)
setfacl -x u:ravi report.txt    # remove ravi’s rule`,
        },
      },
      {
        id: 'quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Goal', 'Command'],
          rows: [
            ['Who am I / which groups', '`whoami`, `id`, `id user`'],
            ['Look up an account', '`getent passwd user`, `getent group group`'],
            ['Run one command as root', '`sudo command`'],
            ['Create / delete a user', '`sudo useradd -m user`, `sudo userdel -r user`'],
            ['Set a password', '`sudo passwd user`'],
            ['Create / delete a group', '`sudo groupadd group`, `sudo groupdel group`'],
            ['Add / remove group member', '`sudo usermod -aG group user`, `sudo gpasswd -d user group`'],
            ['Lock / unlock an account', '`sudo usermod -L user`, `sudo usermod -U user`'],
            ['See permissions', '`ls -l file`, `ls -ld dir`, `stat -c \'%a\' file`'],
            ['Change permissions', '`chmod g+w file`, `chmod 640 file`, `chmod -R …`'],
            ['Change owner / group', '`sudo chown user:group file`, `chgrp group file`'],
            ['Team folder', '`chgrp team dir` + `chmod 2770 dir`'],
            ['Extra access for one user', '`setfacl -m u:name:r file`'],
            ['Show / remove ACL rules', '`getfacl file`, `setfacl -x u:name file`'],
          ],
        },
      },
    ],
    takeaways: [
      '**Users** run everything; **groups** let you grant access to a team. Check yourself with **`id`**; add members with **`usermod -aG`**.',
      'Every file has an **owner**, a **group**, and **rwx** for user / group / others. On directories, **x** means “enter” and **w** means “create or delete inside.”',
      '**`chmod`** changes bits (letters or numbers like **640** / **755**); **`chown`** and **`chgrp`** change who the file belongs to.',
      'Team folders use a shared **group** plus **setgid**; **ACLs** handle one-off exceptions.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-07-onboard-the-payments-team', label: 'Onboard the Payments Team' },
      { challengeId: 'linux-08-lock-down-payment-secrets', label: 'Lock Down Payment Secrets' },
      { challengeId: 'linux-09-shared-drop-folder-for-notifications', label: 'Shared Drop Folder for Notifications' },
    ],
  },
  {
    id: 'processes-and-signals',
    slug: 'processes-and-signals',
    trackId: 'B5',
    eyebrow: 'What is running',
    title: 'Processes and Signals: ps, top, kill, nice',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-10-hunt-the-runaway-process',
    lede:
      'Every program you start — your shell, a web server, even a quick **`ls`** — runs as a **process** with its own number, the **PID**. This post covers how to **see** what is running, how to **stop** or pause a process with **signals** (for example, a script stuck in a loop that eats the whole CPU), and how to make heavy jobs **share** the CPU politely.',
    sections: [
      {
        id: 'what-is-a-process',
        title: 'Processes: programs that are running',
        body: [
          'A **program** is a file on disk, like **`/usr/bin/sleep`**. A **process** is one running copy of it, with its own memory, its own owner, and its own **PID** (process id). Start the same program twice and you get two processes with two PIDs.',
        ],
        subsections: [
          {
            id: 'pid-ppid',
            title: 'PID and parent PID',
            body: [
              'Every process is started by another process, its **parent**. When you type a command, your **shell** is the parent, and the new process records the shell’s PID as its **PPID** (parent PID). Follow the parents far enough and you reach PID **1** — **systemd** on most servers — which the kernel starts at boot.',
              'You can ask the shell for some of these numbers directly. In the shell, a word that starts with **`$`** is replaced by a value before the command runs. **`$$`** is replaced by the PID of the shell itself — so **`echo $$`** prints your shell’s PID.',
              'Normally the shell waits for a command to finish before showing the prompt again. Put **`&`** at the end of a command and the shell starts it **in the background** instead: it prints the new PID and gives you the prompt back straight away. **`$!`** is then replaced by the PID of that last background command.',
            ],
            code: {
              language: 'shell',
              code: `echo $$      # PID of this shell, e.g. 1901
sleep 300 &  # run sleep in the background; prints e.g. [1] 1950
echo $!      # PID of that background sleep: 1950`,
            },
          },
        ],
      },
      {
        id: 'inspect',
        title: 'See what is running: ps, top, pgrep',
        body: [
          'To follow along, start a harmless CPU hog: **`yes > /dev/null &`**. The **`yes`** command prints “y” forever as fast as it can; sending the output to **`/dev/null`** throws it away, so all it does is keep one CPU core at 100%. You will find it and stop it in the next sections.',
        ],
        subsections: [
          {
            id: 'ps',
            title: 'ps: a snapshot of processes',
            body: [
              '**`ps`** prints the processes running **at this moment** and exits. On its own it only shows processes started from your current terminal, which is rarely what you want — so **`ps`** is almost always run with **options** (arguments) that choose **which** processes to show and **which columns** to print.',
              'The most common is **`ps aux`**: **`a`** = processes of all users, **`u`** = user-friendly columns (owner, CPU, memory), **`x`** = include processes with no terminal, like services. **`ps -ef`** is an older style that shows every process with its parent PID. Note that **`aux`** has no dash — **`ps`** accepts both styles.',
              'A few more options come up all the time: **`-p`** picks processes by PID, **`-C`** by exact program name, **`-u`** by user, **`-o`** chooses exactly which columns to print, **`--sort`** orders the output, and **`--forest`** (or **`f`**) draws the parent–child tree.',
            ],
            code: {
              language: 'shell',
              code: `ps                                    # processes in this terminal only
ps aux                                # every process: a=all users, u=details, x=no terminal too
ps -ef                                # every process, with parent PID (PPID)
ps -p 1842                            # one process by PID
ps -C nginx                           # by exact program name
ps -u asha                            # processes owned by asha
ps -o pid,ppid,stat,%cpu,cmd -p 1842  # pick the columns yourself
ps aux --sort=-%cpu | head -5         # top 5 by CPU (- means descending)
ps aux --sort=-%mem | head -5         # top 5 by memory
ps auxf                               # tree view: children under parents`,
            },
          },
          {
            id: 'ps-aux-output',
            title: 'Reading ps aux output',
            body: [
              'Here are two lines of **`ps aux`** with the CPU hog running. The **`yes`** process uses **99.7%** of a core and is in state **R** (running); the **`bash`** shell next to it is sleeping (**S**) and uses nothing.',
            ],
            code: {
              language: 'shell',
              code: `$ ps aux --sort=-%cpu | head -3
USER   PID %CPU %MEM    VSZ   RSS TTY   STAT START  TIME COMMAND
asha  1842 99.7  0.0   8168   900 pts/0 R    10:02  3:41 yes
asha  1901  0.0  0.1  10052  3412 pts/0 S    10:05  0:00 bash`,
            },
          },
          {
            id: 'ps-columns',
            title: 'What the columns mean',
            body: [
              'Most of the time you only need four columns: **PID** to act on the process, **%CPU** and **%MEM** to spot a hog, and **COMMAND** to see what it is. The others help when you dig deeper.',
            ],
            code: {
              language: 'text',
              code: `USER     who started it
PID      process id
%CPU     share of one CPU core in use (99.7 = a full core)
%MEM     share of RAM in use
RSS      memory actually in RAM, in KB
TTY      terminal it is attached to (? = none, e.g. a service)
STAT     state: R, S, D, T, Z (see below)
TIME     total CPU time used so far
COMMAND  the command line that started it`,
            },
          },
          {
            id: 'states',
            title: 'The STAT column: process states',
            body: [
              'The **STAT** column in the **`ps aux`** output above shows each process’s **state** as a letter (**`top`**, covered next, shows the same letter in its **S** column). A process is not always busy: most of the time it is **sleeping** — waiting for a key press, a network reply, or a timer — and uses no CPU at all. In the example, **`yes`** is **R** (running) and **`bash`** is **S** (sleeping).',
            ],
            code: {
              language: 'text',
              code: `STAT  meaning
R     running, or ready to run on a CPU
S     sleeping: waiting for something (input, a timer, the network)
D     waiting on disk; cannot be interrupted until the disk answers
T     stopped (paused), e.g. after Ctrl-Z
Z     zombie: finished, but its parent has not collected the exit status yet`,
            },
          },
          {
            id: 'top',
            title: 'top: a live view',
            body: [
              '**`top`** shows the same information as **`ps`**, but refreshes every few seconds, sorted by CPU use — so a hog floats to the top on its own. The header shows overall load, memory, and how busy the CPUs are.',
              'Inside **`top`** a few keys do most of the work: **P** sorts by CPU, **M** by memory, **1** shows each CPU core separately, **k** asks for a PID and kills it, and **q** quits. **`htop`** is a friendlier version with colours and mouse support, if it is installed.',
            ],
            code: {
              language: 'shell',
              code: `top          # live view, sorted by CPU
top -u asha  # only asha’s processes
top -p 1842  # watch a single PID
htop         # nicer version, if installed`,
            },
          },
          {
            id: 'pgrep',
            title: 'pgrep and pidof: find a PID by name',
            body: [
              'Scanning **`ps aux`** by eye is slow. **`pgrep`** prints the PIDs of processes whose name matches a pattern. Add **`-a`** to see the full command line too, **`-f`** to match against the whole command line instead of just the name, and **`-u`** to limit it to one user. **`pidof`** does the same for an exact program name.',
            ],
            code: {
              language: 'shell',
              code: `pgrep yes                   # 1842
pgrep -a yes                # 1842 yes
pgrep -af 'python3 app.py'  # match the full command line
pgrep -u asha bash          # asha’s bash shells
pidof sshd                  # PIDs of an exact program name`,
            },
          },
          {
            id: 'proc',
            title: '/proc: everything about one process',
            body: [
              'The kernel publishes details for every process as files under **`/proc/PID/`**. Nothing there is on disk — it is generated when you read it. **`status`** has the name, state, owner, and memory; **`cmdline`** has the exact command, with its words separated by invisible **null characters** (**`\\0`**) instead of spaces — that is why the example feeds it to **`tr \'\\0\' \' \'`**, which **tr**anslates every null into a space so it reads normally; **`cwd`** points to the folder it is running in.',
            ],
            code: {
              language: 'shell',
              code: `cat /proc/1842/status | head      # name, state, PPID, owner, memory
tr '\\0' ' ' < /proc/1842/cmdline  # full command line: tr replaces each \\0 (null) separator with a space
ls -l /proc/1842/cwd              # folder it is running in`,
            },
          },
        ],
        table: {
          headers: ['Tool', 'Shows', 'Use it when…'],
          rows: [
            ['`ps aux`', 'Snapshot of every process', 'You want a list right now, or to pipe into `grep` / `sort`'],
            ['`top` / `htop`', 'Live view, sorted by CPU', 'Something is slow and you want to watch it'],
            ['`pgrep -a name`', 'PIDs matching a name', 'You know the name and need the PID'],
            ['`/proc/PID/`', 'Kernel details for one process', 'You need the exact command, folder, or memory'],
          ],
        },
      },
      {
        id: 'signals',
        title: 'Signals: telling a process to stop',
        body: [
          'You do not stop a process directly. You send it a **signal** — a small numbered message delivered by the kernel. Most signals can be **caught** by the program, which lets it clean up first (save work, close files, remove temp files). A couple cannot be caught at all.',
        ],
        subsections: [
          {
            id: 'kill',
            title: 'kill: send a signal to a PID',
            body: [
              'Despite the name, **`kill`** just **sends a signal**. Without options it sends **SIGTERM** — “please exit.” You choose another signal with its number or name: **`kill -9`** and **`kill -KILL`** are the same thing. **`kill -l`** lists every signal.',
              'You can signal your own processes; signalling other users’ processes needs **`sudo`**.',
            ],
            code: {
              language: 'shell',
              code: `kill 1842        # send SIGTERM (15): please exit
kill -TERM 1842  # same, by name
kill -9 1842     # send SIGKILL: stop immediately
kill -l          # list all signals`,
            },
          },
          {
            id: 'common-signals',
            title: 'The signals you will actually use',
            body: [
              'There are dozens of signals, but six cover almost everything. You already send some of them from the keyboard: **Ctrl-C** sends SIGINT to the program in front of you, and **Ctrl-Z** pauses it.',
            ],
            code: {
              language: 'text',
              code: `number  name     sent by             meaning
2       SIGINT   Ctrl-C              interrupt: stop what you are doing
15      SIGTERM  kill (default)      please exit: clean up and quit
9       SIGKILL  kill -9             die now: cannot be caught or ignored
1       SIGHUP   terminal closed     hang up; many services reload config on it
19      SIGSTOP  kill -STOP          pause (Ctrl-Z sends the similar SIGTSTP)
18      SIGCONT  kill -CONT, fg, bg  resume a paused process`,
            },
          },
          {
            id: 'term-then-kill',
            title: 'Ask first, force second',
            body: [
              'Always try **SIGTERM** first. A well-behaved program catches it, finishes or saves what it is doing, and exits cleanly. Give it a few seconds, then check whether it is still there.',
              'Use **SIGKILL** (**`-9`**) only if the process ignores SIGTERM. The kernel removes it on the spot, so it gets no chance to clean up — half-written files and leftover lock files are common side effects.',
            ],
            code: {
              language: 'shell',
              code: `pgrep -a yes            # 1842 yes
kill 1842               # ask politely
sleep 3                 # give it a moment
pgrep yes || echo gone  # prints the PID if still running, else "gone"
kill -9 1842            # only if it is still running`,
            },
          },
          {
            id: 'pkill',
            title: 'pkill and killall: signal by name',
            body: [
              '**`pkill`** sends a signal to every process whose name matches — **`pgrep`** and **`kill`** in one step. **`killall`** does the same for an exact program name. They are convenient, but they hit **every** match, so run the matching **`pgrep`** first to see what you are about to stop.',
            ],
            code: {
              language: 'shell',
              code: `pgrep -a yes           # check what matches first
pkill yes              # SIGTERM to every 'yes' process
pkill -u asha python3  # only asha’s python3 processes
killall -9 yes         # SIGKILL by exact name`,
            },
          },
          {
            id: 'pause-resume',
            title: 'Pause and resume',
            body: [
              'Sometimes you do not want to stop a job, just pause it while something more urgent runs. **SIGSTOP** freezes a process in place (state **T**) and **SIGCONT** lets it carry on exactly where it left off.',
            ],
            code: {
              language: 'shell',
              code: `kill -STOP 1842             # pause: state becomes T
ps -o pid,stat,cmd -p 1842  # check the state
kill -CONT 1842             # resume`,
            },
          },
        ],
        table: {
          headers: ['Goal', 'Command'],
          rows: [
            ['Ask a process to exit', '`kill PID` (SIGTERM)'],
            ['Force it to stop', '`kill -9 PID` (SIGKILL)'],
            ['Stop by name', '`pkill name`, `killall name`'],
            ['Pause / resume', '`kill -STOP PID`, `kill -CONT PID`'],
            ['Stop the program in front of you', '**Ctrl-C**'],
          ],
        },
      },
      {
        id: 'nice',
        title: 'Priority: nice and renice',
        body: [
          'When several processes want the CPU at once, the kernel shares it out. A process’s **niceness** tells the kernel how much to favour it: it goes from **-20** (greedy, gets the most CPU) to **19** (nicest, gets what is left). Everything starts at **0**.',
          'Make long batch jobs — backups, big compressions, reports — **nicer**, so interactive work like your shell and web requests stays responsive. Any user can make their own processes nicer; only root can make a process **less** nice (a lower number).',
        ],
        subsections: [
          {
            id: 'nice-cmd',
            title: 'nice: start a command with a priority',
            body: [
              '**`nice -n N command`** starts the command with niceness **N**. Without **`-n`** it uses **10**, a sensible choice for background work.',
            ],
            code: {
              language: 'shell',
              code: `nice -n 10 tar czf backup.tgz /srv/data  # low priority backup
nice ./report.sh                         # niceness 10 by default
sudo nice -n -5 ./urgent.sh              # higher priority (root only)`,
            },
          },
          {
            id: 'renice',
            title: 'renice: change a running process',
            body: [
              '**`renice`** changes the niceness of a process that is already running — handy when a job you started normally turns out to be heavier than expected. Use **`-p`** for a PID or **`-u`** for all of a user’s processes.',
            ],
            code: {
              language: 'shell',
              code: `renice -n 15 -p 1842       # make PID 1842 nicer
sudo renice -n 0 -p 1842   # back to normal (root only)
sudo renice -n 10 -u ravi  # all of ravi’s processes`,
            },
          },
          {
            id: 'see-ni',
            title: 'Seeing the niceness',
            body: [
              'The **NI** column shows niceness in both **`top`** and **`ps`**. Next to it, **PR** in **`top`** is the kernel’s own priority number, which moves with NI.',
            ],
            code: {
              language: 'shell',
              code: `ps -o pid,ni,cmd -p 1842              # PID, niceness, command
ps -eo pid,ni,comm --sort=-ni | head  # nicest processes first`,
            },
          },
        ],
      },
      {
        id: 'quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Goal', 'Command'],
          rows: [
            ['My shell’s PID / last background PID', '`echo $$`, `echo $!`'],
            ['All processes', '`ps aux`, `ps -ef`'],
            ['Heaviest by CPU / memory', '`ps aux --sort=-%cpu | head`, `--sort=-%mem`'],
            ['Live view', '`top` (P, M, k, q), `htop`'],
            ['Find a PID by name', '`pgrep -a name`, `pidof name`'],
            ['Details for one process', '`cat /proc/PID/status`'],
            ['Ask to exit / force', '`kill PID`, `kill -9 PID`'],
            ['Stop by name', '`pkill name`, `killall name`'],
            ['Pause / resume', '`kill -STOP PID`, `kill -CONT PID`'],
            ['Start with low priority', '`nice -n 10 command`'],
            ['Change priority', '`renice -n 15 -p PID`'],
          ],
        },
      },
    ],
    takeaways: [
      'A **process** is a running program with a **PID** and a parent (**PPID**); most of the time it is **sleeping**, not using CPU.',
      'See processes with **`ps aux`** (snapshot), **`top`** (live), and **`pgrep -a`** (by name); **`/proc/PID/`** has the details.',
      '**`kill`** sends **signals**: SIGTERM (default) first, **`-9`** only if it is ignored. **`pkill`** works by name — check with **`pgrep`** first.',
      '**`nice`** and **`renice`** make heavy jobs share the CPU; higher niceness means lower priority.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-10-hunt-the-runaway-process', label: 'Hunt the Runaway Process' },
    ],
  },
  {
    id: 'background-jobs-and-nohup',
    slug: 'background-jobs-and-nohup',
    trackId: 'B6',
    eyebrow: 'Keep work running',
    title: 'Background Jobs: &, jobs, nohup, tmux',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-11-keep-the-batch-running-after-logout',
    lede:
      'Some commands take minutes or hours — a big backup, a large download, a report over a year of data. This post covers how to run them **in the background** so you can keep using the terminal, how to **manage** them with job control, and how to keep them running even after you **close the terminal or log out**.',
    sections: [
      {
        id: 'foreground-background',
        title: 'Foreground and background',
        body: [
          'When you run a command, the shell normally **waits** for it to finish before showing the prompt again. That command runs in the **foreground**: it owns the terminal, and you cannot type anything else until it is done. For a one-second **`ls`** that is fine; for a backup that takes an hour, it is not.',
          'The examples use **`./backup.sh`**, a script that copies a large folder and takes a long time. Any slow command works the same way — **`sleep 600`** is an easy one to practise with.',
        ],
        subsections: [
          {
            id: 'ampersand',
            title: '&: start a command in the background',
            body: [
              'Put **`&`** at the end of a command and the shell starts it **in the background**: it prints a **job number** in brackets and the process **PID**, then gives you the prompt back immediately. The command keeps running while you do other things.',
              'One catch: a background command still prints its output to your terminal, mixed into whatever you are typing. That is why background commands are almost always combined with **output redirection** (next).',
            ],
            code: {
              language: 'shell',
              code: `sleep 600 &    # prints e.g. [1] 2290: job 1, PID 2290
./backup.sh &  # runs, but its output still lands on screen`,
            },
          },
          {
            id: 'redirect',
            title: 'Send the output to a file',
            body: [
              'Programs have two output streams: **stdout** for normal output and **stderr** for errors. **`> file`** sends stdout into a file instead of the screen. **`2>&1`** means “send stderr (stream **2**) to the same place as stdout (stream **1**)”, so errors end up in the same file. The order matters: put **`2>&1`** **after** **`> file`**.',
              'Now the job runs quietly, and you can check on it whenever you like with **`tail -f`**.',
            ],
            code: {
              language: 'shell',
              code: `./backup.sh > backup.log 2>&1 &   # output and errors go to backup.log
tail -f backup.log                # watch progress; Ctrl-C stops watching, not the job
./backup.sh >> backup.log 2>&1 &  # >> appends instead of overwriting`,
            },
          },
        ],
      },
      {
        id: 'job-control',
        title: 'Job control: jobs, fg, bg, Ctrl-Z',
        body: [
          'Every command you start from a shell is a **job** of that shell, numbered **1**, **2**, **3**… The shell lets you list them, pause them, and move them between foreground and background. In job commands you refer to a job as **`%1`**, **`%2`**, and so on — different from a PID.',
        ],
        subsections: [
          {
            id: 'jobs',
            title: 'jobs: list what this shell is running',
            body: [
              '**`jobs`** shows the jobs started from **this** shell, with their number, state (**Running** or **Stopped**), and command. The **`+`** marks the current job — the one **`fg`** and **`bg`** act on if you do not give a number — and **`-`** the one before it. Add **`-l`** to see PIDs too.',
            ],
            code: {
              language: 'shell',
              code: `$ ./backup.sh > backup.log 2>&1 &
[1] 2301
$ sleep 600 &
[2] 2302
$ jobs
[1]-  Running    ./backup.sh > backup.log 2>&1 &
[2]+  Running    sleep 600 &`,
            },
          },
          {
            id: 'ctrl-z-bg',
            title: 'Ctrl-Z and bg: forgot the &?',
            body: [
              'Started a long command in the foreground by mistake? Press **Ctrl-Z**. The shell **pauses** the job (state **Stopped**) and gives you the prompt back. Then type **`bg`** and the paused job **continues in the background**, exactly as if you had added **`&`** in the first place.',
            ],
            code: {
              language: 'shell',
              code: `$ ./backup.sh > backup.log 2>&1
^Z
[1]+  Stopped    ./backup.sh > backup.log 2>&1
$ bg
[1]+ ./backup.sh > backup.log 2>&1 &
$ jobs
[1]+  Running    ./backup.sh > backup.log 2>&1 &`,
            },
          },
          {
            id: 'fg',
            title: 'fg: bring a job back to the foreground',
            body: [
              '**`fg`** moves a background or stopped job into the foreground, so it owns the terminal again — useful when a job asks a question, or when you want to stop it with **Ctrl-C**. Without a number it picks the current (**`+`**) job.',
            ],
            code: {
              language: 'shell',
              code: `fg       # bring the current job (+) to the foreground
fg %2    # bring job 2
bg %1    # resume job 1 in the background
kill %1  # send SIGTERM to job 1 (no PID needed)`,
            },
          },
        ],
        table: {
          headers: ['Action', 'How'],
          rows: [
            ['Start in the background', '`command &`'],
            ['List jobs', '`jobs`, `jobs -l` (with PIDs)'],
            ['Pause the foreground job', '**Ctrl-Z**'],
            ['Resume it in the background', '`bg` or `bg %N`'],
            ['Bring a job to the foreground', '`fg` or `fg %N`'],
            ['Stop a job', '`kill %N`, or **Ctrl-C** when it is in the foreground'],
          ],
        },
      },
      {
        id: 'hangup',
        title: 'Why jobs die when you close the terminal',
        body: [
          'Background jobs still belong to the shell that started them. When that shell’s terminal goes away — you close the terminal window, or log out — the system sends the shell a **SIGHUP** (“hang up”) signal, and the shell passes it on to its jobs. The default reaction to SIGHUP is to **exit**, so your hour-long backup stops halfway.',
          'This matters most on servers. You usually reach a remote Linux server with **SSH** (“secure shell”) — a program that opens a terminal on the server over the network. Close your laptop or lose Wi-Fi and the SSH connection drops, which counts as closing the terminal: every job you started in that session receives SIGHUP. (SSH itself gets its own post later in the track.)',
          'There are two ways out: make the job **ignore** SIGHUP (**`nohup`**, **`disown`**), or run it inside a terminal session that **does not close** when you disconnect (**`tmux`**, **`screen`**).',
        ],
      },
      {
        id: 'nohup-disown',
        title: 'Surviving logout: nohup and disown',
        body: [
          'Both commands make a job immune to SIGHUP. Use **`nohup`** when you are **starting** the command, and **`disown`** when it is **already running**.',
        ],
        subsections: [
          {
            id: 'nohup',
            title: 'nohup: start a command that ignores hang-ups',
            body: [
              '**`nohup command`** starts the command with SIGHUP ignored, so closing the terminal no longer stops it. Add **`&`** as well, or the command still runs in the foreground and holds your prompt.',
              'If you do not redirect the output, **`nohup`** writes it to a file called **`nohup.out`** in the current folder. It is clearer to name your own log file.',
            ],
            code: {
              language: 'shell',
              code: `nohup ./backup.sh > backup.log 2>&1 &  # survives logout, output in backup.log
nohup ./backup.sh &                    # output goes to ./nohup.out
exit                                   # log out; the backup keeps going`,
            },
          },
          {
            id: 'disown',
            title: 'disown: protect a job that is already running',
            body: [
              'Already started the job without **`nohup`**? **`disown`** removes it from the shell’s job list, so the shell will not pass SIGHUP to it when you log out. Use **`disown %N`** for a specific job, or **`disown -h`** to keep it in **`jobs`** but still protect it.',
            ],
            code: {
              language: 'shell',
              code: `./backup.sh > backup.log 2>&1 &  # started normally: [1] 2301
disown %1                        # job 1 will survive logout
jobs                             # no longer listed`,
            },
          },
          {
            id: 'check-later',
            title: 'Checking on it later',
            body: [
              'After you log back in, the job is no longer in **`jobs`** — that list belongs to the **old** shell. Find it like any other process with **`pgrep`** or **`ps`**, and follow its log file.',
            ],
            code: {
              language: 'shell',
              code: `pgrep -af backup.sh  # 2301 /bin/bash ./backup.sh: still running
tail -f backup.log   # see how far it got
kill 2301            # stop it if needed`,
            },
          },
        ],
      },
      {
        id: 'tmux',
        title: 'Sessions that stay open: tmux and screen',
        body: [
          '**`nohup`** keeps one command alive, but you cannot come back and interact with it. **`tmux`** (and the older **`screen`**) solve the problem differently: they run a **terminal session on the server** that keeps going when you disconnect. You can **detach** from it, log out, log back in hours later, and **attach** again — everything inside is exactly as you left it, still running.',
        ],
        subsections: [
          {
            id: 'tmux-basics',
            title: 'tmux: start, detach, attach',
            body: [
              'Start a named session with **`tmux new -s name`** and run your commands in it as usual. To leave it running, press **Ctrl-b**, let go, then press **d** (detach). Later, **`tmux ls`** lists sessions and **`tmux attach -t name`** reconnects.',
            ],
            code: {
              language: 'shell',
              code: `tmux new -s backup           # start a session called backup
./backup.sh                  # run normally inside it; no & or nohup needed
                             # (press Ctrl-b, then d, to detach)
tmux ls                      # list sessions: backup: 1 windows ...
tmux attach -t backup        # reconnect to it
tmux kill-session -t backup  # end the session when done`,
            },
          },
          {
            id: 'tmux-keys',
            title: 'Keys inside tmux',
            body: [
              'Every tmux shortcut starts with the **prefix** **Ctrl-b**: press it, release, then press the next key. These are the ones you will use first:',
            ],
            code: {
              language: 'text',
              code: `key (after Ctrl-b)  what it does
d                   detach: leave everything running, go back to the normal shell
c                   create a new window inside the session
n / p               next / previous window
%  /  "             split the window side by side / top and bottom
[                   scroll mode (arrows, PgUp); q to leave`,
            },
          },
          {
            id: 'screen',
            title: 'screen: the older alternative',
            body: [
              '**`screen`** works the same way and is still installed on many servers. Its prefix is **Ctrl-a** instead of Ctrl-b.',
            ],
            code: {
              language: 'shell',
              code: `screen -S backup  # start a named session
                  # (press Ctrl-a, then d, to detach)
screen -ls        # list sessions
screen -r backup  # reattach`,
            },
          },
        ],
        table: {
          headers: ['Tool', 'Survives logout?', 'Can you interact later?', 'Best for'],
          rows: [
            ['`command &`', 'No', 'Only from the same shell', 'Short jobs while you keep working'],
            ['`nohup … &`', 'Yes', 'No — read its log', 'One long command you start and forget'],
            ['`disown`', 'Yes', 'No — read its log', 'Rescuing a job you already started'],
            ['`tmux` / `screen`', 'Yes', 'Yes — reattach any time', 'Long or interactive work on a server'],
          ],
        },
      },
      {
        id: 'quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Goal', 'Command'],
          rows: [
            ['Run in the background', '`command > log 2>&1 &`'],
            ['Watch its output', '`tail -f log`'],
            ['List / foreground / background', '`jobs`, `fg %N`, `bg %N`'],
            ['Pause the foreground job', '**Ctrl-Z**'],
            ['Survive logout (new command)', '`nohup command > log 2>&1 &`'],
            ['Survive logout (running job)', '`disown %N`'],
            ['Find it after logging back in', '`pgrep -af name`'],
            ['tmux session', '`tmux new -s name`, **Ctrl-b d**, `tmux attach -t name`'],
            ['screen session', '`screen -S name`, **Ctrl-a d**, `screen -r name`'],
          ],
        },
      },
    ],
    takeaways: [
      '**`&`** runs a command in the background; redirect its output with **`> log 2>&1`** and follow it with **`tail -f`**.',
      '**`jobs`**, **Ctrl-Z**, **`bg`**, and **`fg`** move jobs between foreground and background in one shell.',
      'Closing the terminal or dropping an SSH connection sends **SIGHUP**, which stops your jobs — **`nohup`** (new) or **`disown`** (running) prevent that.',
      '**`tmux`** / **`screen`** keep a whole session alive on the server, so you can detach and reattach later.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      {
        challengeId: 'linux-11-keep-the-batch-running-after-logout',
        label: 'Keep the Batch Running After Logout',
      },
    ],
  },
  {
    id: 'systemd-and-journalctl',
    slug: 'systemd-and-journalctl',
    trackId: 'B7',
    eyebrow: 'Services that start on boot',
    title: 'Services with systemd: systemctl, unit files, journalctl',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-12-run-order-processor-as-a-service',
    lede:
      'Some programs should run **all the time** — a web app, a database, an SSH server — start by themselves when the machine boots, and come back if they crash. On most Linux servers that is the job of **systemd**. This post covers how to **control** services with **`systemctl`**, **write** your own unit file, and **read** service logs with **`journalctl`**.',
    sections: [
      {
        id: 'what-is-a-service',
        title: 'Services: programs that run all the time',
        body: [
          'A **service** (also called a **daemon**) is a program that runs in the background with no terminal attached, waiting to do work — answering web requests, accepting SSH logins, running scheduled jobs. Nobody starts it by hand each morning; the system does.',
          'You could start a program with **`nohup … &`**, but that only covers half the job: it will not start again after a **reboot**, and nobody restarts it if it **crashes**. **systemd** handles both. It is the very first process the kernel starts (PID **1**), and it starts, stops, watches, and restarts everything else.',
          'The examples use a small web app, **`/opt/hello/app.py`**, that we want running on port 8080 at all times.',
        ],
        subsections: [
          {
            id: 'units',
            title: 'Units: what systemd manages',
            body: [
              'systemd calls each thing it manages a **unit**, described by a small text file. The file name ends with the unit’s **type**: **`.service`** for a program to run, **`.timer`** for a schedule, **`.target`** for a group of units that make up a stage of boot (for example **`multi-user.target`**, “the normal running system”).',
              'This post is about **`.service`** units. When a command expects a unit name you can usually leave off **`.service`** — **`hello`** and **`hello.service`** mean the same thing.',
            ],
            code: {
              language: 'shell',
              code: `systemctl list-units --type=service                  # services systemd has loaded
systemctl list-units --type=service --state=running  # only the running ones
systemctl list-unit-files --type=service             # every service file, and whether it starts at boot`,
            },
          },
        ],
      },
      {
        id: 'systemctl',
        title: 'systemctl: control a service',
        body: [
          '**`systemctl`** is the command you use to talk to systemd. Looking at a service is allowed for everyone; starting, stopping, or changing one needs **`sudo`**.',
        ],
        subsections: [
          {
            id: 'status',
            title: 'status: is it running?',
            body: [
              '**`systemctl status`** is always the first command to run. It shows whether the service is running, since when, its PID, how much memory it uses, and the last few lines of its log — usually enough to see what is wrong. Press **`q`** to get back to the prompt.',
            ],
            code: {
              language: 'shell',
              code: `$ systemctl status hello
● hello.service - Hello web app
     Loaded: loaded (/etc/systemd/system/hello.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-10-05 09:12:04 UTC; 2h 3min ago
   Main PID: 812 (python3)
      Tasks: 1 (limit: 4613)
     Memory: 18.2M
        CPU: 1.204s
     CGroup: /system.slice/hello.service
             └─812 /usr/bin/python3 /opt/hello/app.py

Oct 05 09:12:04 web-1 systemd[1]: Started hello.service - Hello web app.
Oct 05 09:12:05 web-1 python3[812]: Listening on port 8080`,
            },
          },
          {
            id: 'status-parts',
            title: 'Reading the status output',
            body: [
              'The two lines that matter most are **Loaded** (does systemd know about the unit, and will it start at boot?) and **Active** (is it running right now?). A service can be **enabled** but **inactive** — it will start at the next boot, but is stopped now — or the other way round.',
            ],
            code: {
              language: 'text',
              code: `●            green = running, white = stopped, red = failed
Loaded       where the unit file is; "enabled" = starts at boot
Active       the current state, and for how long
Main PID     the PID of the program systemd started
Memory, CPU  resources it is using right now
CGroup       every process that belongs to this service
last lines   the most recent log lines from the journal`,
            },
          },
          {
            id: 'start-stop',
            title: 'start, stop, restart, reload',
            body: [
              'These change what is happening **right now**, and do not affect what happens at the next boot. **`restart`** stops and starts the program — the usual step after you change its configuration. **`reload`** asks the program to re-read its config **without** stopping; only some services support it (web servers such as **nginx** do).',
            ],
            code: {
              language: 'shell',
              code: `sudo systemctl start hello    # start it now
sudo systemctl stop hello     # stop it now
sudo systemctl restart hello  # stop + start, e.g. after a config change
sudo systemctl reload nginx   # re-read config without stopping (if supported)`,
            },
          },
          {
            id: 'enable-disable',
            title: 'enable and disable: start at boot',
            body: [
              '**`enable`** tells systemd to start the service **automatically at every boot**; **`disable`** stops that. Neither one starts or stops the service now — add **`--now`** to do both in one go. This is the most common surprise: a service that works until the first reboot was usually started but never **enabled**.',
            ],
            code: {
              language: 'shell',
              code: `sudo systemctl enable hello         # start at every boot (not now)
sudo systemctl enable --now hello   # start at boot AND start now
sudo systemctl disable --now hello  # stop now and do not start at boot
systemctl is-enabled hello          # enabled / disabled
systemctl is-active hello           # active / inactive / failed`,
            },
          },
          {
            id: 'failed',
            title: 'Finding failed services',
            body: [
              'When something on a server is broken, list the services that have **failed** first. After you fix the cause, **`reset-failed`** clears the red “failed” mark.',
            ],
            code: {
              language: 'shell',
              code: `systemctl --failed                 # every unit in the failed state
systemctl is-failed hello          # failed / active / inactive
sudo systemctl reset-failed hello  # clear the failed state after fixing it`,
            },
          },
        ],
        table: {
          headers: ['Command', 'Affects', 'What it does'],
          rows: [
            ['`status`', '—', 'Show state, PID, memory, recent logs'],
            ['`start` / `stop` / `restart`', 'Now', 'Run, stop, or restart the service'],
            ['`reload`', 'Now', 'Re-read config without stopping (if supported)'],
            ['`enable` / `disable`', 'Boot', 'Start / do not start at boot'],
            ['`enable --now`', 'Both', 'Start now and at every boot'],
            ['`--failed`', '—', 'List failed units'],
          ],
        },
      },
      {
        id: 'unit-file',
        title: 'Writing a unit file',
        body: [
          'To turn your own program into a service, you write a **unit file**: a short text file in sections, each with **`Key=value`** lines. Your own units go in **`/etc/systemd/system/`**. Units installed by packages live in **`/lib/systemd/system/`** — read them for examples, but do not edit them there.',
          'Here is a complete unit for the hello app, saved as **`/etc/systemd/system/hello.service`**:',
        ],
        codes: [
          {
            language: 'ini',
            filename: 'hello.service',
            code: `[Unit]
Description=Hello web app
After=network-online.target
Wants=network-online.target

[Service]
User=hello
WorkingDirectory=/opt/hello
ExecStart=/usr/bin/python3 /opt/hello/app.py
Environment=PORT=8080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target`,
          },
        ],
      },
      {
        id: 'unit-sections',
        title: 'What each section means',
        body: [
          'The three sections answer three questions: **what** is this and when should it start (**[Unit]**), **how** do you run it (**[Service]**), and **at which point of boot** should it be switched on (**[Install]**).',
        ],
        subsections: [
          {
            id: 'unit-section',
            title: '[Unit]: description and ordering',
            body: [
              '**`Description=`** is the friendly name shown in **`status`**. **`After=`** controls **order**: start this unit only after the listed ones have started. **`Wants=`** pulls the other unit in as well, but carries on if it fails; **`Requires=`** is stricter — if the required unit fails or stops, this one stops too.',
              '**`After=`** on its own does not start anything; it only orders units that are starting anyway. That is why the example uses **`Wants=network-online.target`** together with **`After=network-online.target`**: “make sure the network comes up, and start me after it.”',
            ],
          },
          {
            id: 'service-section',
            title: '[Service]: how to run the program',
            body: [
              '**`ExecStart=`** is the command to run. It must use a **full path** (**`/usr/bin/python3`**, not just **`python3`**) — systemd does not search your PATH like a shell does, and shell tricks like **`&&`**, **`>`** or **`~`** do not work here.',
              '**`User=`** runs the program as that user instead of root — always do this for your own apps. **`WorkingDirectory=`** is the folder it starts in, and **`Environment=`** sets variables it can read.',
              '**`Restart=on-failure`** tells systemd to start the program again if it crashes (exits with an error); **`Restart=always`** restarts it whenever it exits. **`RestartSec=`** waits that many seconds before trying again, so a broken app does not restart hundreds of times a minute.',
            ],
          },
          {
            id: 'install-section',
            title: '[Install]: where it hooks into boot',
            body: [
              '**`WantedBy=multi-user.target`** means “start this when the system reaches normal running mode” — the right choice for almost every server app. This section is only used by **`enable`** and **`disable`**: **`enable`** creates a link that adds the service to that target, which is how it starts at boot.',
            ],
          },
          {
            id: 'use-unit',
            title: 'Putting it to work',
            body: [
              'systemd reads unit files into memory, so after you create or change one, run **`daemon-reload`** to make it read them again — forgetting this is the classic reason an edit “does nothing.” Then enable and start the service, and check it.',
              '**`systemctl cat`** prints a unit exactly as systemd sees it, and **`systemctl edit`** creates a small **override** file, so you can change one setting without touching the original.',
            ],
            code: {
              language: 'shell',
              code: `sudo nano /etc/systemd/system/hello.service  # create the unit (any editor works)
sudo systemctl daemon-reload                 # make systemd re-read unit files
sudo systemctl enable --now hello            # start now and at every boot
systemctl status hello                       # check it is active (running)
systemctl cat hello                          # show the unit as systemd sees it
sudo systemctl edit hello                    # add an override without editing the file`,
            },
          },
        ],
      },
      {
        id: 'journalctl',
        title: 'journalctl: read service logs',
        body: [
          'Anything a service prints — normal output and errors — is collected by systemd into the **journal**, together with systemd’s own messages about starting and stopping it. **`journalctl`** reads the journal. You may need **`sudo`**, or membership in the **`adm`** / **`systemd-journal`** group, to see other services’ logs.',
        ],
        subsections: [
          {
            id: 'journal-unit',
            title: 'Logs for one service',
            body: [
              '**`-u`** limits the output to one unit — almost always what you want. **`-n`** shows only the last N lines, and **`--no-pager`** prints straight to the terminal instead of opening a **`less`**-style viewer.',
            ],
            code: {
              language: 'shell',
              code: `$ journalctl -u hello -n 5
Oct 05 11:40:12 web-1 python3[812]: GET / 200
Oct 05 11:40:15 web-1 python3[812]: GET /health 200
Oct 05 11:41:02 web-1 python3[812]: Traceback (most recent call last):
Oct 05 11:41:02 web-1 python3[812]: KeyError: 'PORT'
Oct 05 11:41:02 web-1 systemd[1]: hello.service: Main process exited, code=exited, status=1/FAILURE`,
            },
          },
          {
            id: 'journal-options',
            title: 'Useful options',
            body: [
              '**`-f`** follows new lines live, like **`tail -f`**. **`-e`** jumps to the end. **`--since`** and **`--until`** limit the time range and understand plain words like **`"1 hour ago"`** or **`today`**. **`-b`** shows only the current boot (**`-b -1`** the one before), and **`-p err`** only errors and worse.',
            ],
            code: {
              language: 'shell',
              code: `journalctl -u hello                       # all logs for hello (opens a viewer)
journalctl -u hello -n 50 --no-pager      # last 50 lines, printed directly
journalctl -u hello -f                    # follow live; Ctrl-C to stop
journalctl -u hello --since "1 hour ago"  # only the last hour
journalctl -u hello --since today -p err  # today’s errors only
journalctl -b -p err                      # all errors since this boot`,
            },
          },
        ],
      },
      {
        id: 'debugging',
        title: 'When a service will not start',
        body: [
          'Work through the same three steps every time: **`status`** to see the state and the last log lines, **`journalctl -u`** to read the full error, then fix the cause, **`daemon-reload`** if you edited the unit, and **`restart`**. The most common causes:',
        ],
        bullets: [
          '**Wrong path in `ExecStart=`** — the log says “No such file or directory.” Use the full path to the program and to the script.',
          '**Permission denied** — the **`User=`** cannot read the app folder or run the script. Check with **`ls -l`** and fix ownership or permissions.',
          '**Port already in use** — another process holds the port. Find it with **`sudo ss -ltnp`**.',
          '**Edited the unit but nothing changed** — you forgot **`sudo systemctl daemon-reload`**.',
          '**Works until reboot** — it was started but never **enabled**.',
          '**Keeps restarting** — **`Restart=`** is bringing back a program that crashes immediately; the real error is earlier in **`journalctl -u`**.',
        ],
        codes: [
          {
            language: 'shell',
            code: `systemctl status hello                # 1. state + last log lines
journalctl -u hello -n 50 --no-pager  # 2. the full error
sudo systemctl daemon-reload          # 3. after editing the unit
sudo systemctl restart hello          # 4. try again
systemctl status hello                # 5. confirm it is running`,
          },
        ],
      },
      {
        id: 'quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Goal', 'Command'],
          rows: [
            ['Is it running?', '`systemctl status name`'],
            ['Start / stop / restart', '`sudo systemctl start|stop|restart name`'],
            ['Start at boot (and now)', '`sudo systemctl enable --now name`'],
            ['Do not start at boot', '`sudo systemctl disable name`'],
            ['List services / failed ones', '`systemctl list-units --type=service`, `systemctl --failed`'],
            ['After editing a unit', '`sudo systemctl daemon-reload`'],
            ['Show / override a unit', '`systemctl cat name`, `sudo systemctl edit name`'],
            ['Service logs', '`journalctl -u name -n 50 --no-pager`'],
            ['Follow logs live', '`journalctl -u name -f`'],
            ['Logs in a time range', '`journalctl -u name --since "1 hour ago"`'],
            ['Errors this boot', '`journalctl -b -p err`'],
          ],
        },
      },
    ],
    takeaways: [
      'A **service** runs in the background all the time; **systemd** (PID 1) starts it at boot and restarts it if it crashes.',
      '**`systemctl status`** first; **`start` / `stop` / `restart`** change now, **`enable` / `disable`** change boot — **`enable --now`** does both.',
      'Unit files in **`/etc/systemd/system/`** have **[Unit]** (order), **[Service]** (**`ExecStart=`** with full paths, **`User=`**, **`Restart=`**), and **[Install]** (**`WantedBy=multi-user.target`**). Run **`daemon-reload`** after every edit.',
      '**`journalctl -u name`** shows a service’s logs; **`-f`**, **`-n`**, **`--since`**, and **`-p err`** narrow them down.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-12-run-order-processor-as-a-service', label: 'Run order-processor as a Service' },
      { challengeId: 'linux-13-restart-on-crash-start-in-order', label: 'Restart on Crash, Start in Order' },
      { challengeId: 'linux-14-debug-a-failing-unit', label: 'Debug a Failing Unit' },
    ],
  },
  {
    id: 'cron-and-log-rotation',
    slug: 'cron-and-log-rotation',
    trackId: 'B8',
    eyebrow: 'Time and disk hygiene',
    title: 'Cron and Log Rotation',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-15-nightly-reconciliation',
    lede:
      '**cron** runs commands on a schedule; **logrotate** keeps log folders from eating the disk. A **neighborhood backup co-op** runs **`rsync`** nightly and rotates **`/var/log/backup/`** — this post explains the mechanics in plain language.',
    sections: [
      {
        id: 'coop-story',
        title: 'Midnight sync, logs never deleted',
        body: [
          'The co-op’s Linux mirror runs **`/usr/local/bin/nightly-sync`** at 2 a.m. Nobody noticed **`backup.log`** growing for a year until **`df`** complained. You add a **crontab** line and a **logrotate** rule.',
        ],
      },
      {
        id: 'cron',
        title: 'crontab lines',
        body: [
          '**`crontab -e`** edits your user schedule. Five fields: minute, hour, day-of-month, month, day-of-week, then command. **`@daily`** shortcuts exist on some systems.',
        ],
        code: {
          language: 'shell',
          code: `# m h dom mon dow command
0 2 * * * /usr/local/bin/nightly-sync >> /var/log/backup/sync.log 2>&1`,
        },
      },
      {
        id: 'logrotate',
        title: 'logrotate',
        body: [
          'Rules in **`/etc/logrotate.d/`** define **rotate**, **weekly/daily**, **compress**, **copytruncate** or **create**, and **postrotate** hooks. **`logrotate -d`** dry-run shows what would happen.',
        ],
      },
    ],
    takeaways: [
      '**cron** schedules repeating jobs; always redirect output somewhere useful.',
      '**logrotate** archives or deletes old logs — configure before disk fills.',
      'Test schedules and rotation with dry runs and small **`--since`** windows.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-15-nightly-reconciliation', label: 'Nightly Reconciliation' },
      { challengeId: 'linux-16-rotate-notification-logs', label: 'Rotate Notification Logs' },
    ],
  },
  {
    id: 'packages-and-pinning',
    slug: 'packages-and-pinning',
    trackId: 'B9',
    eyebrow: 'Installed software',
    title: 'Packages and Pinning',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-17-install-and-pin-tools',
    lede:
      'Distros install software with a **package manager** (**`apt`** on Debian/Ubuntu). **Pinning** holds a package at a version so upgrades do not break a demo. A **science museum** exhibit PC must keep a known **ffmpeg** build for a looping video wall.',
    sections: [
      {
        id: 'museum-story',
        title: 'Auto-upgrade broke the loop',
        body: [
          'Ubuntu **`unattended-upgrades`** bumped **ffmpeg**; the planetarium clip stuttered. You install a vetted version, **pin** it, and document how to upgrade deliberately.',
        ],
      },
      {
        id: 'apt-basics',
        title: 'apt commands',
        body: [],
        table: {
          headers: ['Command', 'Role'],
          rows: [
            ['`apt update`', 'Refresh package index'],
            ['`apt install pkg`', 'Install'],
            ['`apt policy pkg`', 'Show candidate + pin priority'],
            ['`apt-mark hold pkg`', 'Block upgrade (simple hold)'],
          ],
        },
      },
      {
        id: 'pinning',
        title: 'Pinning (concept)',
        body: [
          '**`/etc/apt/preferences.d/`** files set **priorities** so a version or source wins. **`apt-cache policy`** confirms what will install. Pinning is for **controlled** environments — exhibits, kiosks, legacy apps.',
        ],
      },
    ],
    takeaways: [
      '**`apt update`** then **`install`**; **`policy`** shows versions.',
      '**hold** or **preferences** prevent surprise upgrades on fixed-role machines.',
      'Treat package changes like any production change — test the exhibit loop after.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-17-install-and-pin-tools', label: 'Install and Pin Tools' },
    ],
  },
  {
    id: 'storage-df-du-and-archives',
    slug: 'storage-df-du-and-archives',
    trackId: 'B10',
    eyebrow: 'Disk space',
    title: 'Storage: df, du, mounts, and tar',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-18-disk-full-on-the-order-box',
    lede:
      'A Linux server can report “no space left” even when you do not know which folder grew. This post shows how to read filesystem capacity with **`df`**, trace usage with **`du`**, understand where disks are **mounted**, and create safe backup bundles with **`tar`** before removing anything.',
    sections: [
      {
        id: 'storage-map',
        title: 'From a disk to a folder',
        body: [
          'Linux presents files as one tree beginning at **`/`**, but that tree can contain several storage devices. The system **mounts** each filesystem at a directory called a **mount point**. The root filesystem is mounted at `/`; another disk might be mounted at `/data` or `/backup`.',
          'That distinction explains the two main space commands. **`df`** asks a filesystem, “How much capacity is free?” **`du`** walks files under a path and asks, “How much space do these files use?” You normally start with `df`, then use `du` inside the filesystem that is full.',
        ],
        table: {
          headers: ['Word', 'Meaning', 'Example'],
          rows: [
            ['Device', 'The disk, partition, or logical volume that stores blocks', '`/dev/nvme0n1p1`'],
            ['Filesystem', 'The format that organizes files on that device', 'ext4, XFS'],
            ['Mount point', 'The directory where that filesystem appears in the Linux tree', '`/`, `/data`, `/backup`'],
            ['Capacity', 'Space available to the whole mounted filesystem', 'Shown by `df`'],
            ['Usage', 'Space occupied by files below a path', 'Measured by `du`'],
          ],
        },
        callout: {
          kind: 'idea',
          title: 'One tree can hide several disks',
          body: [
            'If `/backup` is a separate mount, moving a file from `/srv` to `/backup` moves the data to another filesystem. If it is only an ordinary directory on `/`, the same move does **not** free space on `/`.',
          ],
        },
      },
      {
        id: 'df-du',
        title: 'Start broad: df shows filesystem capacity',
        body: [
          '**`df`** means “disk free.” It reports each mounted filesystem, its total size, used and available space, and where it is mounted. **`-h`** uses readable units such as GiB instead of raw 1 KiB blocks.',
          'Look first at **Use%** and **Mounted on**. If the line mounted on `/` is at 100%, investigate folders on `/`. If `/data` is full, investigate `/data`; cleaning an unrelated filesystem will not help.',
        ],
        code: {
          language: 'shell',
          code: `$ df -h
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p1   40G   38G  1.8G  96% /
/dev/nvme1n1     200G   61G  140G  31% /backup

df -h /var              # show the filesystem that contains /var
df -T /                 # include its filesystem type
df -i /                 # inode usage: number of files, not bytes`,
        },
        subsections: [
          {
            id: 'inodes',
            title: 'Space can run out in two ways',
            body: [
              'A filesystem can exhaust **bytes** because a few files are huge, or exhaust **inodes** because it contains millions of tiny files. Every file and directory needs an inode. In the second case `df -h` may show free bytes while programs still receive “No space left on device.”',
              'Run **`df -i`** and check **IUse%**. If it is near 100%, find directories with enormous file counts instead of looking only for large files.',
            ],
          },
        ],
      },
      {
        id: 'du',
        title: 'Narrow down: du shows directory usage',
        body: [
          '**`du`** means “disk usage.” It walks through a path and adds up the blocks used by files below it. **`-s`** gives one summary instead of every nested path, and **`-h`** uses readable units.',
          'Work from broad to narrow. Summarize the top-level directories, enter the largest one, and repeat. Use **`sudo`** when permission errors would otherwise hide system directories.',
        ],
        code: {
          language: 'shell',
          code: `sudo du -xhd1 / 2>/dev/null | sort -h
sudo du -xhd1 /var 2>/dev/null | sort -h
sudo du -xhd1 /var/log 2>/dev/null | sort -h
du -sh /srv/orders                    # one total
du -ah /var/log | sort -h | tail -20  # largest entries near the end`,
        },
        subsections: [
          {
            id: 'du-options',
            title: 'Why -x and max depth matter',
            body: [
              '**`-x`** keeps `du` on one filesystem. Without it, scanning `/` may descend into separately mounted backup disks, network shares, or virtual filesystems and make the numbers confusing.',
              '**`-d1`** (the same idea as **`--max-depth=1`**) prints only one level below the path. That gives a useful shortlist instead of thousands of lines. BSD/macOS `du` uses slightly different options, but this track targets GNU tools on Linux.',
            ],
          },
          {
            id: 'find-large-files',
            title: 'Find individual large files',
            body: [
              'Once you know which directory is large, **`find`** can list individual files over a threshold. The `-printf` form below prints size in bytes and path; numeric sorting puts the largest at the end.',
            ],
            code: {
              language: 'shell',
              code: `sudo find /var -xdev -type f -size +500M -printf '%s %p\\n' |
  sort -n

sudo find /var/log -xdev -type f -mtime +30 -ls  # old files; inspect only`,
            },
          },
        ],
        callout: {
          kind: 'warn',
          title: 'Measure before you delete',
          body: [
            'Do not start with `rm -rf` because a filesystem is full. Identify the filesystem, identify the large path, confirm what owns it, and make a backup when the data may be needed.',
          ],
        },
      },
      {
        id: 'df-du-disagree',
        title: 'When df and du disagree',
        body: [
          'Sometimes `df` says the filesystem is full but `du` cannot account for the space. A common cause is a process that still has a deleted file open. The directory entry is gone, so `du` cannot see it, but the filesystem cannot reclaim the blocks until the process closes the file.',
          '**`lsof +L1`** lists open files whose link count is below 1. Restarting or safely signalling the owning service closes the file and releases the space. Do not truncate an unknown `/proc/PID/fd/...` entry without understanding the service.',
        ],
        code: {
          language: 'shell',
          code: `sudo lsof +L1                 # look for large entries marked (deleted)
sudo systemctl restart app   # if app owns the deleted log and restart is safe
df -h /                      # confirm that the blocks were released`,
        },
      },
      {
        id: 'mounts',
        title: 'See and manage mounts',
        body: [
          '**`lsblk`** shows block devices as a tree. **`findmnt`** shows which filesystems are mounted and where. These are clearer than reading the full output of `mount` when you are building a storage map.',
        ],
        code: {
          language: 'shell',
          code: `lsblk -f                 # devices, filesystem types, labels, UUIDs, mount points
findmnt                   # mounted filesystems as a tree
findmnt /backup           # what device supplies this path?
findmnt -T /var/log/app   # filesystem containing this exact path`,
        },
        subsections: [
          {
            id: 'temporary-mount',
            title: 'Mount a filesystem temporarily',
            body: [
              'Create an empty directory, then mount the device there. The existing contents of that directory are hidden while the mount is active, so use a dedicated mount point. **`umount`** removes the attachment; it does not erase the disk.',
            ],
            code: {
              language: 'shell',
              code: `sudo mkdir -p /backup
sudo mount /dev/nvme1n1 /backup
findmnt /backup
sudo umount /backup`,
            },
          },
          {
            id: 'fstab',
            title: 'Make a mount survive reboot',
            body: [
              'Temporary mounts disappear at reboot. Persistent mounts are declared in **`/etc/fstab`**, preferably by stable **UUID** rather than a device name that could change. A bad entry can delay or break boot, so back up the file and test it before rebooting.',
            ],
            code: {
              language: 'shell',
              code: `sudo blkid /dev/nvme1n1       # copy the filesystem UUID
sudo cp /etc/fstab /etc/fstab.bak
sudoedit /etc/fstab
sudo mount -a                   # test every not-yet-mounted fstab entry
findmnt --verify                # check fstab syntax and references`,
            },
          },
        ],
      },
      {
        id: 'tar',
        title: 'Create a safe archive with tar',
        body: [
          '**`tar`** combines a directory tree into one archive while preserving paths and metadata. It does not free space by itself: after you create and verify an archive, the original files still exist until you deliberately remove or move them.',
          'The common operation letters are **`c`** create, **`t`** list, **`x`** extract, **`f`** archive filename, and **`z`** gzip compression. **`v`** is optional verbose output; leaving it out is quieter for large archives.',
        ],
        table: {
          headers: ['Goal', 'Command shape'],
          rows: [
            ['Create an uncompressed archive', '`tar -cf archive.tar directory/`'],
            ['Create a gzip-compressed archive', '`tar -czf archive.tgz directory/`'],
            ['List without extracting', '`tar -tzf archive.tgz`'],
            ['Extract into a chosen directory', '`tar -xzf archive.tgz -C destination/`'],
            ['Exclude matching paths', "`tar -czf archive.tgz --exclude='*.tmp' directory/`"],
          ],
        },
        subsections: [
          {
            id: 'tar-c-example',
            title: 'Control the paths stored in the archive',
            body: [
              '**`-C directory`** tells `tar` to change into that directory before collecting files. This avoids embedding a long absolute-looking source path and makes restores predictable.',
            ],
            code: {
              language: 'shell',
              code: `sudo tar -czf /backup/orders-2026-10-06.tgz \
  -C /srv orders

tar -tzf /backup/orders-2026-10-06.tgz | head
mkdir -p /tmp/restore-check
tar -xzf /backup/orders-2026-10-06.tgz -C /tmp/restore-check`,
            },
          },
          {
            id: 'verify-archive',
            title: 'Verify before cleanup',
            body: [
              'A command exiting with status 0 is a good start, but also list the archive and test-extract it when the data matters. Confirm that expected files, permissions, and directory structure are present. Only then decide whether old source data can be removed.',
            ],
          },
        ],
        callout: {
          kind: 'warn',
          title: 'Do not extract an unknown archive as root',
          body: [
            'Inspect it with `tar -tf` first and extract into an empty temporary directory. Archives can contain unexpected paths, links, ownership, or files that overwrite existing data.',
          ],
        },
      },
      {
        id: 'disk-full-runbook',
        title: 'A safe disk-full runbook',
        body: [
          'Use the same order every time. The goal is to restore service without deleting evidence or moving data onto the same full filesystem by mistake.',
        ],
        flows: [
          {
            title: 'From alert to recovered space',
            steps: [
              'Confirm the error and affected path',
              'Run df -h and df -i',
              'Map the path with findmnt',
              'Use du from broad to narrow',
              'Check deleted-open files',
              'Archive or clean the confirmed owner',
              'Recheck space and service health',
            ],
          },
        ],
        codes: [
          {
            language: 'shell',
            code: `df -h /var/log/app
df -i /var/log/app
findmnt -T /var/log/app
sudo du -xhd1 /var | sort -h
sudo lsof +L1
df -h /var/log/app`,
          },
        ],
      },
      {
        id: 'storage-quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Question', 'Command'],
          rows: [
            ['Which filesystem is full?', '`df -h`, `df -h path`'],
            ['Did it run out of inodes?', '`df -i path`'],
            ['Which top-level directory is large?', '`du -xhd1 path | sort -h`'],
            ['Which large files are present?', '`find path -xdev -type f -size +500M -ls`'],
            ['Is a deleted file still open?', '`sudo lsof +L1`'],
            ['Which device backs this path?', '`findmnt -T path`, `lsblk -f`'],
            ['Create / list / extract an archive', '`tar -czf`, `tar -tzf`, `tar -xzf`'],
            ['Validate persistent mounts', '`sudo mount -a`, `findmnt --verify`'],
          ],
        },
      },
    ],
    takeaways: [
      '**`df`** reports capacity for a mounted filesystem; **`du`** walks a path and totals file usage. Start with `df`, then narrow with `du -x`.',
      'Check both **bytes** (`df -h`) and **inodes** (`df -i`), and use **`lsof +L1`** when deleted-open files make `df` and `du` disagree.',
      '**Mounts** attach filesystems inside the one Linux tree. Use **`findmnt`** / **`lsblk`** to map them and test `/etc/fstab` with **`mount -a`** before rebooting.',
      '**`tar`** bundles a tree; list and test-extract the archive before deleting source data.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-18-disk-full-on-the-order-box', label: 'Disk Full on the Order Box' },
      { challengeId: 'linux-19-archive-and-roll-back-releases', label: 'Archive and Roll Back Releases' },
    ],
  },
  {
    id: 'networking-basics',
    slug: 'networking-basics',
    trackId: 'B11',
    eyebrow: 'Reachability',
    title: 'Networking Basics for Operators',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-20-why-cant-order-reach-payment',
    lede:
      'When one service cannot reach another, “the network is down” is too broad to be useful. This post turns an endpoint such as **`http://payment:8080/health`** into small checks: resolve the name, choose a route, reach the host, confirm a process is listening, and verify that a firewall allows the connection.',
    sections: [
      {
        id: 'endpoint-parts',
        title: 'Start with the exact endpoint',
        body: [
          'Suppose **order-processor** must call **`http://payment:8080/health`**. Write that exact value down before testing. It contains a **protocol** (`http`), **host name** (`payment`), **port** (`8080`), and **path** (`/health`). Each part can fail independently.',
          'Run tests from the machine where the failure occurs. A successful request from your laptop proves only that your laptop can connect; it does not prove that `order-processor` has the same DNS, route, or firewall access.',
        ],
        table: {
          headers: ['Part', 'Example', 'Question'],
          rows: [
            ['Protocol', '`http`', 'What conversation should the client speak?'],
            ['Host', '`payment`', 'What IP address should the name resolve to?'],
            ['Port', '`8080`', 'Which process should receive the connection?'],
            ['Path', '`/health`', 'Which HTTP resource should answer?'],
          ],
        },
        callout: {
          kind: 'tip',
          title: 'Test from the failing side',
          body: [
            'If app A cannot reach app B, open a shell on app A’s host and test B from there. Source address and network policy are part of the result.',
          ],
        },
      },
      {
        id: 'network-model',
        title: 'What happens during a connection',
        body: [
          'The client first turns the host name into an IP address, then checks its routing table to choose an interface and next hop. It sends packets toward that IP and port. On the destination, a process must be listening on the correct address, and every firewall along the path must allow the traffic.',
        ],
        flows: [
          {
            title: 'From URL to response',
            steps: [
              'Resolve host name',
              'Choose route and source address',
              'Reach destination host',
              'Pass network firewalls',
              'Connect to listening port',
              'Speak the application protocol',
            ],
          },
        ],
        after: [
          'Debug in roughly that order, but also inspect the destination listener early. There is no value changing firewall rules if the application is stopped or listening only on `127.0.0.1`.',
        ],
      },
      {
        id: 'local-network',
        title: 'Check local addresses and routes',
        body: [
          '**`ip addr`** shows addresses assigned to each network interface. **`ip route`** shows where packets go. A normal server usually has a route for its local network and a **default route** for everything else.',
        ],
        code: {
          language: 'shell',
          code: `ip -br addr                    # compact interface and address list
ip route                       # routing table
ip route get 10.20.4.18        # route, interface, and source IP for one target
ip link show                   # interface state: UP or DOWN`,
        },
        subsections: [
          {
            id: 'route-output',
            title: 'Read the route decision',
            body: [
              'Output such as `10.20.4.18 via 10.20.1.1 dev eth0 src 10.20.1.25` means: send through gateway `10.20.1.1`, using interface `eth0`, with source address `10.20.1.25`. “Network is unreachable” usually means no matching route exists or the interface is down.',
              'The loopback address **`127.0.0.1`** means “this machine.” A service reachable at `127.0.0.1:8080` may still be unreachable from another host.',
            ],
          },
        ],
      },
      {
        id: 'dns',
        title: 'Resolve names: getent and dig',
        body: [
          '**DNS** maps names to IP addresses. On Linux, **`getent hosts`** uses the same system resolver configuration that most applications use, including `/etc/hosts` and DNS. That makes it the best first check for “does this machine resolve this name?”',
          '**`dig`** shows detailed DNS answers and which DNS server replied. It is useful when you need to distinguish no record, the wrong record, or a resolver problem.',
        ],
        code: {
          language: 'shell',
          code: `getent hosts payment
getent ahostsv4 payment
dig payment
dig +short payment
cat /etc/resolv.conf          # configured DNS resolver/search domains`,
        },
        callout: {
          kind: 'warn',
          title: 'An IP address can hide a DNS problem',
          body: [
            'If `curl http://10.20.4.18:8080` works but `curl http://payment:8080` does not, routing and the listener are probably fine. Investigate name resolution rather than opening ports.',
          ],
        },
      },
      {
        id: 'reachability',
        title: 'Reach the host: ping and tracepath',
        body: [
          '**`ping`** sends ICMP echo requests and measures replies. A reply proves basic IP reachability, but no reply does **not** prove the host is down: many firewalls block ICMP while allowing application traffic.',
          '**`tracepath`** (or `traceroute`, when installed) shows the sequence of routers toward a destination. Missing hops are clues, not absolute proof, because routers may choose not to answer trace packets.',
        ],
        code: {
          language: 'shell',
          code: `ping -c 4 payment
ping -c 4 10.20.4.18
tracepath 10.20.4.18`,
        },
      },
      {
        id: 'listeners',
        title: 'Check the destination: ss shows listening ports',
        body: [
          'A port is not a program by itself. A process creates a socket and **listens** on an address and port. Run **`ss`** on the destination server to see whether that socket exists.',
        ],
        code: {
          language: 'shell',
          code: `sudo ss -ltnp
sudo ss -ltnp 'sport = :8080'
ss -lnt                         # TCP listeners, without process names
ss -tnp                         # established TCP connections`,
        },
        table: {
          headers: ['Option', 'Meaning'],
          rows: [
            ['`-l`', 'Listening sockets only'],
            ['`-t`', 'TCP sockets'],
            ['`-u`', 'UDP sockets'],
            ['`-n`', 'Numeric addresses and ports; do not resolve names'],
            ['`-p`', 'Owning process (often needs `sudo`)'],
          ],
        },
        subsections: [
          {
            id: 'bind-address',
            title: 'The bind address matters',
            body: [
              '`127.0.0.1:8080` accepts connections only from the same machine. `0.0.0.0:8080` accepts IPv4 connections arriving on any local interface. `10.20.4.18:8080` accepts connections sent to that particular address.',
              'If the service is listening on the wrong address, fix its bind/listen configuration and restart it. A firewall cannot make a loopback-only listener reachable remotely.',
            ],
          },
        ],
      },
      {
        id: 'test-port-protocol',
        title: 'Test the port and the protocol',
        body: [
          '**`nc -vz`** tests whether a TCP connection can be established. **`curl`** goes further for HTTP: it connects, sends an HTTP request, and shows the response. Use the tool that speaks the service’s protocol whenever possible.',
        ],
        code: {
          language: 'shell',
          code: `nc -vz payment 8080
curl -v --connect-timeout 5 http://payment:8080/health
curl -vk --connect-timeout 5 https://payment:8443/health
curl -sS -o /dev/null -w '%{http_code}\\n' http://payment:8080/health`,
        },
        subsections: [
          {
            id: 'read-errors',
            title: 'Error messages narrow the problem',
            body: [
              '**Could not resolve host** points to DNS. **Network is unreachable** points to local addressing or routing. **Connection timed out** usually means packets or replies were dropped, often by routing or a firewall. **Connection refused** means the host replied but nothing accepted that port (or a firewall actively rejected it).',
              'An HTTP status such as **404**, **401**, or **500** proves the network connection succeeded and an HTTP server answered. Move up to application configuration, authentication, or logs.',
            ],
          },
          {
            id: 'tls',
            title: 'HTTPS adds TLS checks',
            body: [
              'With HTTPS, `curl -v` also reveals certificate and hostname failures. **`-k`** skips certificate verification and is useful only as a short diagnostic comparison; it is not a production fix. Correct the certificate, hostname, trust chain, or system clock instead.',
            ],
          },
        ],
      },
      {
        id: 'firewalls',
        title: 'Firewalls: allow the smallest path',
        body: [
          'A host firewall (`nftables`, `iptables`, or `ufw`) can filter traffic on the server. Cloud security groups and network firewalls can filter it before packets reach the server. A valid rule needs the direction, protocol, destination port, and allowed source.',
          'The safe requirement is specific: “allow TCP port 8080 on payment only from the order subnet,” not “turn off the firewall.” Confirm the listener first, inspect current rules, change one layer, then retest from the original client.',
        ],
        code: {
          language: 'shell',
          code: `sudo nft list ruleset          # nftables systems
sudo iptables -L -n -v         # legacy iptables view
sudo ufw status verbose        # when Ubuntu UFW is managing rules`,
        },
        callout: {
          kind: 'warn',
          title: 'Do not flush a remote server’s firewall',
          body: [
            'A broad reset can expose services or lock you out of SSH. Add the narrow required rule through the system’s established firewall tooling and preserve the current session while testing.',
          ],
        },
      },
      {
        id: 'troubleshooting',
        title: 'A layer-by-layer troubleshooting routine',
        body: [
          'Keep the client and destination checks separate. Record each result; do not jump from a timeout straight to changing firewall rules.',
        ],
        table: {
          headers: ['Check', 'Run where?', 'Command'],
          rows: [
            ['Resolve the service name', 'Client', '`getent hosts payment`'],
            ['Choose route and source IP', 'Client', '`ip route get IP`'],
            ['Test the real HTTP endpoint', 'Client', '`curl -v --connect-timeout 5 URL`'],
            ['Confirm service state', 'Destination', '`systemctl status service`'],
            ['Confirm bind address and port', 'Destination', "`sudo ss -ltnp 'sport = :8080'`"],
            ['Inspect host firewall', 'Destination', '`sudo nft list ruleset`'],
            ['Read application errors', 'Destination', '`journalctl -u service -n 50`'],
          ],
        },
        flows: [
          {
            title: 'Interpret the first failing layer',
            steps: [
              'Name resolves',
              'Route exists',
              'Packets reach host',
              'Firewall permits source',
              'Process listens correctly',
              'Protocol returns expected response',
            ],
          },
        ],
      },
      {
        id: 'network-quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Question', 'Command'],
          rows: [
            ['What addresses do I have?', '`ip -br addr`'],
            ['How will this target be reached?', '`ip route get IP`'],
            ['What IP does this name resolve to?', '`getent hosts name`, `dig +short name`'],
            ['Does the host answer ICMP?', '`ping -c 4 host`'],
            ['What is listening locally?', '`sudo ss -ltnp`'],
            ['Can TCP connect?', '`nc -vz host port`'],
            ['Can the HTTP service answer?', '`curl -v URL`'],
            ['What firewall rules are loaded?', '`nft list ruleset`, `iptables -L -n -v`'],
          ],
        },
      },
    ],
    takeaways: [
      'Write down the exact **protocol, host, port, and path**, and test from the client that actually fails.',
      'Work through **name resolution → route → reachability → firewall → listener → application response**; the first failing layer is your best clue.',
      '**`ss -ltnp`** on the destination proves whether a process is listening and whether it is bound to loopback, one interface, or all interfaces.',
      'A failed `ping` does not prove a host is down, while an HTTP status code proves the network path and TCP connection worked.',
      'Keep firewall rules narrow by source, protocol, and port; never disable security controls just to make a test pass.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-20-why-cant-order-reach-payment', label: 'Why Can\'t Order Reach Payment?' },
      { challengeId: 'linux-21-open-only-the-right-ports', label: 'Open Only the Right Ports' },
    ],
  },
  {
    id: 'ssh-keys-and-login',
    slug: 'ssh-keys-and-login',
    trackId: 'B12',
    eyebrow: 'Remote access',
    title: 'SSH Keys and Login',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-22-ssh-keys-for-the-deploy-bot',
    lede:
      '**SSH** gives you an encrypted terminal on another Linux machine. This post starts with a normal login, explains host identity, builds a public/private **key pair**, installs the public key safely, and troubleshoots the permissions and configuration that commonly break key authentication.',
    sections: [
      {
        id: 'what-ssh-does',
        title: 'SSH: a secure remote shell',
        body: [
          'When you run **`ssh student@server`**, the `ssh` **client** on your machine opens an encrypted connection to the SSH **server** (`sshd`) on the remote machine. After authentication, the server starts a shell as the requested user. Commands run on the remote machine, not on your laptop.',
          'SSH protects the connection from being read or changed in transit. It still has to answer two identity questions: **is this really the server I intended to reach?** and **am I allowed to log in as this user?** Host keys answer the first; a password or user key answers the second.',
        ],
        flows: [
          {
            title: 'One SSH login',
            steps: [
              'Connect to host and port',
              'Verify the server host key',
              'Authenticate the user',
              'Start an encrypted remote shell',
            ],
          },
        ],
        code: {
          language: 'shell',
          code: `ssh student@server.example
ssh -p 2222 student@server.example  # non-default SSH port
hostname                            # runs remotely after login
exit                                # close the remote shell`,
        },
      },
      {
        id: 'host-keys',
        title: 'First connection: verify the server',
        body: [
          'The first time you connect, SSH shows the server’s **host-key fingerprint** and asks whether to trust it. Compare that fingerprint with a value from a trusted source — your cloud console, administrator, or provisioning output — before answering `yes`.',
          'Once accepted, the client stores the host key in **`~/.ssh/known_hosts`**. Future connections compare the presented key with that saved value. A loud “REMOTE HOST IDENTIFICATION HAS CHANGED” warning can mean a server was rebuilt, but it can also mean traffic is being intercepted; verify the new fingerprint before replacing the entry.',
        ],
        code: {
          language: 'shell',
          code: `ssh-keygen -F server.example        # show saved host-key entries
ssh-keyscan server.example           # fetches a key; does NOT prove it is trusted
ssh-keygen -R server.example         # remove old entry only after verification`,
        },
        callout: {
          kind: 'warn',
          title: 'Do not blindly accept a changed host key',
          body: [
            'Confirm why it changed and compare the new fingerprint through a separate trusted channel. Deleting `known_hosts` removes the warning, not the risk.',
          ],
        },
      },
      {
        id: 'passwords-vs-keys',
        title: 'User authentication: passwords and keys',
        body: [
          'A password proves identity by sending knowledge of one secret through the encrypted connection. It is easy for a person to use, but weak passwords can be guessed and automation has to store the password somewhere.',
          'A key login uses a **key pair**. The public key is installed on the server. The private key remains with the client. During login, the client proves it possesses the private key without sending that private key across the network.',
        ],
        table: {
          headers: ['Item', 'Where it belongs', 'Can it be shared?'],
          rows: [
            ['Public key (`.pub`)', 'Remote account’s `~/.ssh/authorized_keys`', 'Yes, with systems you want to access'],
            ['Private key (no `.pub`)', 'Your machine, agent, or protected CI secret', 'No'],
            ['Private-key passphrase', 'Known by the operator / unlocked in an agent', 'No'],
            ['Server host private key', 'On the SSH server', 'No'],
            ['Public host key / fingerprint', 'Distributed to clients for verification', 'Yes, through a trusted channel'],
          ],
        },
      },
      {
        id: 'generate-key',
        title: 'Generate a key pair',
        body: [
          '**Ed25519** is a strong, compact default on current systems. **`ssh-keygen`** creates two files: the private key at the path you choose and a public key with `.pub` appended. The comment is only a label that helps humans identify the key.',
          'Use a passphrase for an interactive human key. It encrypts the private-key file at rest, so stealing the file alone is not enough. Automation may require a different protected setup, but should still use a dedicated key with the smallest necessary access.',
        ],
        code: {
          language: 'shell',
          code: `ssh-keygen -t ed25519 -f ~/.ssh/devsetu_lab -C "asha laptop"
ls -l ~/.ssh/devsetu_lab*
ssh-keygen -lf ~/.ssh/devsetu_lab.pub  # show public-key fingerprint
cat ~/.ssh/devsetu_lab.pub             # safe public line to install`,
        },
        callout: {
          kind: 'warn',
          title: 'The file without .pub is private',
          body: [
            'Never paste it into chat, tickets, logs, or source control. If a private key may have leaked, remove its public key from every server and create a new pair.',
          ],
        },
      },
      {
        id: 'install-public-key',
        title: 'Install the public key on the server',
        body: [
          'The remote account accepts user keys listed in **`~/.ssh/authorized_keys`**, one public key per line. **`ssh-copy-id`** logs in using an existing method (often a password), creates the files, appends the public key, and normally fixes permissions.',
        ],
        code: {
          language: 'shell',
          code: `ssh-copy-id -i ~/.ssh/devsetu_lab.pub student@server.example
ssh -i ~/.ssh/devsetu_lab student@server.example`,
        },
        subsections: [
          {
            id: 'manual-install',
            title: 'Manual installation',
            body: [
              'If `ssh-copy-id` is unavailable, append the **single public-key line** while logged in through an existing trusted session. `umask 077` ensures newly created files are private.',
            ],
            code: {
              language: 'shell',
              code: `# Run on the remote server as the target user:
umask 077
mkdir -p ~/.ssh
cat >> ~/.ssh/authorized_keys
# paste the one-line contents of devsetu_lab.pub, then press Ctrl-D
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys`,
            },
          },
          {
            id: 'permissions-owner',
            title: 'Permissions and ownership matter',
            body: [
              '`sshd` may reject `authorized_keys` if the home directory, `.ssh`, or the file can be changed by other users. The target user should own them; `.ssh` should normally be **700** and `authorized_keys` **600**.',
            ],
            code: {
              language: 'shell',
              code: `ls -ld ~ ~/.ssh ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
chown -R "$USER":"$(id -gn)" ~/.ssh`,
            },
          },
        ],
      },
      {
        id: 'using-keys',
        title: 'Use keys without a long command',
        body: [
          '**`-i`** selects a private identity file. For hosts you use often, put the settings in **`~/.ssh/config`** and give the connection a short alias. The config file should be readable and writable only by you.',
        ],
        codes: [
          {
            language: 'ssh-config',
            filename: '~/.ssh/config',
            code: `Host orders-stage
  HostName stage.example.com
  User deploy
  Port 22
  IdentityFile ~/.ssh/orders_stage
  IdentitiesOnly yes`,
          },
          {
            language: 'shell',
            code: `chmod 600 ~/.ssh/config
ssh orders-stage
ssh -G orders-stage | less  # print the final configuration SSH will use`,
          },
        ],
        subsections: [
          {
            id: 'agent',
            title: 'ssh-agent: unlock once per session',
            body: [
              '**`ssh-agent`** keeps an unlocked private key in memory so you do not type its passphrase for every connection. Desktop environments often start an agent already. **`ssh-add`** loads a key and **`ssh-add -l`** lists loaded fingerprints.',
            ],
            code: {
              language: 'shell',
              code: `ssh-add ~/.ssh/devsetu_lab
ssh-add -l
ssh student@server.example`,
            },
          },
        ],
      },
      {
        id: 'copy-files',
        title: 'Copy files over SSH',
        body: [
          '**`scp`** copies a file or directory through SSH. **`rsync`** is better for repeated transfers because it compares source and destination and sends only changes. A colon separates the remote host from its path.',
        ],
        code: {
          language: 'shell',
          code: `scp report.txt student@server.example:/tmp/
scp student@server.example:/var/log/app.log .
scp -r release/ student@server.example:/opt/app/
rsync -av --progress release/ student@server.example:/opt/app/`,
        },
        callout: {
          kind: 'tip',
          title: 'Watch the trailing slash in rsync',
          body: [
            '`rsync release/ host:/opt/app/` copies the **contents** of `release`. Without the source slash, it creates `/opt/app/release`.',
          ],
        },
      },
      {
        id: 'automation',
        title: 'Keys for automation',
        body: [
          'A deploy bot should have its own remote user and its own key pair; never copy a person’s private key into CI. Store the private key in the CI platform’s protected secret store, limit who can read it, and rotate it.',
          'An `authorized_keys` entry can be restricted with options such as `from=` (allowed source addresses), `command=` (one forced command), and disabling forwarding or pseudo-terminals. Apply restrictions only after testing the exact automation flow.',
        ],
        code: {
          language: 'text',
          code: `from="10.20.0.0/16",no-agent-forwarding,no-port-forwarding,no-pty ssh-ed25519 AAAA... deploy-bot`,
        },
      },
      {
        id: 'ssh-debugging',
        title: 'When key login fails',
        body: [
          'Add **`-v`** for diagnostic output (`-vvv` for more detail). It shows which config files were read, which keys were offered, whether the server accepted one, and where authentication stopped. The private key contents are not printed.',
        ],
        code: {
          language: 'shell',
          code: `ssh -v -i ~/.ssh/devsetu_lab student@server.example
ssh -G server.example | grep -E '^(user|hostname|port|identityfile) '
sudo journalctl -u ssh -n 50 --no-pager   # Ubuntu/Debian server
sudo journalctl -u sshd -n 50 --no-pager  # many other distributions`,
        },
        table: {
          headers: ['Symptom', 'Likely check'],
          rows: [
            ['`Permission denied (publickey)`', 'Correct remote user, key offered, public line installed'],
            ['Key offered but rejected', '`authorized_keys` content, ownership, and permissions'],
            ['Connection refused', '`sshd` state, listener, host, and port'],
            ['Connection timed out', 'Route and firewall before authentication'],
            ['Host identification changed', 'Verify the server’s new host-key fingerprint'],
            ['Too many authentication failures', 'Use `IdentitiesOnly yes` with the intended key'],
          ],
        },
      },
      {
        id: 'ssh-quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Goal', 'Command'],
          rows: [
            ['Log in', '`ssh user@host`'],
            ['Use a chosen key / port', '`ssh -i key -p port user@host`'],
            ['Create an Ed25519 pair', '`ssh-keygen -t ed25519 -f path`'],
            ['Install a public key', '`ssh-copy-id -i key.pub user@host`'],
            ['Load / list agent keys', '`ssh-add key`, `ssh-add -l`'],
            ['Debug negotiation and authentication', '`ssh -v user@host`'],
            ['Copy a file', '`scp file user@host:/path/`'],
            ['Sync a directory', '`rsync -av source/ user@host:/path/`'],
            ['Inspect final client config', '`ssh -G alias`'],
          ],
        },
      },
    ],
    takeaways: [
      'SSH verifies both sides: the client checks the server’s **host key**, and the server authenticates the requested **user**.',
      '**`ssh-keygen`** creates a pair. Install only the **public** `.pub` line in `authorized_keys`; the private key never leaves its protected client or secret store.',
      'Use **`~/.ssh/config`** for repeatable host settings and **`ssh-agent`** to cache an unlocked human key in memory.',
      'When login fails, use **`ssh -v`** and check the remote user, offered identity, `authorized_keys`, ownership, and permissions.',
      'Automation gets a dedicated user and key with the smallest practical permissions—not a copied personal key.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-22-ssh-keys-for-the-deploy-bot', label: 'SSH Keys for the Deploy Bot' },
    ],
  },
  {
    id: 'bash-scripting-basics',
    slug: 'bash-scripting-basics',
    trackId: 'B13',
    eyebrow: 'Automate the repeat work',
    title: 'Bash Scripting Basics',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-23-script-the-health-check',
    lede:
      'A shell script is a text file that runs commands in a repeatable order. This post builds one from the first **shebang** through variables, arguments, tests, loops, functions, exit codes, safer failure handling, and debugging—using a small service health check throughout.',
    sections: [
      {
        id: 'first-script',
        title: 'Your first script',
        body: [
          'Typing commands at the prompt is ideal for exploration. Once the same steps must run every morning, on several servers, or from cron, place them in a file so the computer follows the same sequence every time.',
          'The first line, **`#!/usr/bin/env bash`**, is the **shebang**. When you execute the file directly, it tells the kernel to find `bash` in the current environment and use it to interpret the file. Comments start with `#`; the shebang is the special first-line exception.',
        ],
        code: {
          language: 'shell',
          filename: 'hello.sh',
          code: `#!/usr/bin/env bash

# Print a timestamped message.
echo "$(date -Is) hello from $(hostname)"`,
        },
        after: [
          'Save the file, make it executable once, then run it with `./`. The `./` matters because the current directory is normally not searched for commands.',
        ],
        codes: [
          {
            language: 'shell',
            code: `chmod +x hello.sh
./hello.sh
bash hello.sh       # also works; bash reads the file directly`,
          },
        ],
        callout: {
          kind: 'tip',
          title: 'Use Unix line endings',
          body: [
            'A script copied from Windows may fail with `/usr/bin/env: bash\\r: No such file or directory`. Convert CRLF line endings to LF with your editor or `dos2unix`.',
          ],
        },
      },
      {
        id: 'variables',
        title: 'Variables and quoting',
        body: [
          'Assign a variable with **no spaces** around `=`. Read it with `$name` or `${name}`. The braces make the boundary clear when text follows the variable name.',
          'Double quotes allow variable and command substitution while keeping the result one argument. Single quotes preserve text literally. Unquoted variables are split on spaces and may expand wildcard characters, so **quote variable expansions by default**.',
        ],
        code: {
          language: 'shell',
          code: `service_name="order processor"
port=8080
url="http://127.0.0.1:\${port}/health"
now="$(date -Is)"

echo "$service_name"
echo "checking $url at $now"
echo '$url stays literal inside single quotes'`,
        },
        table: {
          headers: ['Form', 'What Bash does'],
          rows: [
            ['`"$name"`', 'Substitute the value and keep it as one argument'],
            ["`'$name'`", 'Keep the dollar sign and text literally'],
            ['`${name}_log`', 'Substitute `name`, then append `_log`'],
            ['`$(command)`', 'Run a command and substitute its output'],
            ['`$((count + 1))`', 'Evaluate integer arithmetic'],
          ],
        },
        callout: {
          kind: 'warn',
          title: 'Make "$var" a reflex',
          body: [
            'A path such as `Daily Reports/report 1.csv` becomes several arguments when `$path` is unquoted. Write `"$path"` unless you specifically intend word splitting or glob expansion.',
          ],
        },
      },
      {
        id: 'arguments',
        title: 'Inputs: positional arguments',
        body: [
          'Arguments let one script work with different values. **`$0`** is the script name, **`$1`** and **`$2`** are the first two arguments, **`$#`** is the count, and **`"$@"`** represents all arguments while preserving each one separately.',
        ],
        code: {
          language: 'shell',
          filename: 'check-url.sh',
          code: `#!/usr/bin/env bash

url="\${1:-http://127.0.0.1:8080/health}"
timeout="\${2:-5}"

echo "checking $url (timeout: \${timeout}s)"
curl -fsS --max-time "$timeout" "$url"`,
        },
        after: [
          '**`${1:-default}`** means “use `$1` when it is set and non-empty; otherwise use this default.” Run it as `./check-url.sh` or provide both values: `./check-url.sh https://example.com/health 10`.',
        ],
        subsections: [
          {
            id: 'required-argument',
            title: 'Reject missing required input',
            body: [
              'Some values should not have a default. Check the argument count, print a useful **usage** line to stderr, and exit with a non-zero status.',
            ],
            code: {
              language: 'shell',
              code: `if (( $# < 1 )); then
  echo "usage: $0 URL [TIMEOUT_SECONDS]" >&2
  exit 2
fi`,
            },
          },
        ],
      },
      {
        id: 'exit-status',
        title: 'Exit status: how commands report success',
        body: [
          'Every command returns a small integer when it finishes: **0 means success** and a non-zero value means failure. The shell stores the most recent status in **`$?`**, but scripts are clearer when they test the command directly.',
          'A script returns the status of its last command unless it uses **`exit N`**. Monitoring, cron, systemd, and CI use that final status to decide whether the script succeeded.',
        ],
        code: {
          language: 'shell',
          code: `if curl -fsS --max-time 5 "$url" >/dev/null; then
  echo "healthy: $url"
  exit 0
else
  echo "unhealthy: $url" >&2
  exit 1
fi`,
        },
        callout: {
          kind: 'idea',
          title: 'Test the command, not $?',
          body: [
            '`if command; then ...` is easier to read and harder to break than running `command`, doing something else, and later inspecting `$?`.',
          ],
        },
      },
      {
        id: 'tests-conditionals',
        title: 'Tests and conditionals',
        body: [
          '**`if`** runs commands based on an exit status. The **`[[ ... ]]`** form performs Bash tests without many of the quoting and pattern pitfalls of the older `[ ... ]` command. Use spaces inside the brackets.',
        ],
        code: {
          language: 'shell',
          code: `if [[ -f "$config" ]]; then
  echo "config exists"
elif [[ -d "$config" ]]; then
  echo "that path is a directory" >&2
else
  echo "config missing: $config" >&2
  exit 1
fi`,
        },
        table: {
          headers: ['Test', 'True when…'],
          rows: [
            ['`[[ -f "$path" ]]`', 'Path is a regular file'],
            ['`[[ -d "$path" ]]`', 'Path is a directory'],
            ['`[[ -r "$path" ]]` / `-w` / `-x`', 'Path is readable / writable / executable'],
            ['`[[ -z "$value" ]]` / `-n`', 'String is empty / non-empty'],
            ['`[[ "$a" == "$b" ]]`', 'Strings are equal'],
            ['`(( count > 10 ))`', 'Integer comparison is true'],
          ],
        },
        subsections: [
          {
            id: 'and-or',
            title: 'AND and OR command lists',
            body: [
              '**`&&`** runs the next command only after success; **`||`** runs it only after failure. They are convenient for short actions, but use a full `if` when you need logging, cleanup, or more than one command.',
            ],
            code: {
              language: 'shell',
              code: `mkdir -p "$output_dir" && echo "output directory ready"
curl -fsS "$url" >/dev/null || { echo "health check failed" >&2; exit 1; }`,
            },
          },
        ],
      },
      {
        id: 'loops',
        title: 'Repeat work with loops',
        body: [
          'A **`for`** loop repeats once for each supplied word or matched path. Quote variables inside the loop, but leave an intentional glob such as `/var/log/*.log` unquoted so the shell can expand it.',
        ],
        code: {
          language: 'shell',
          code: `for url in \
  "http://order:8080/health" \
  "http://payment:8081/health"
do
  echo "checking $url"
  curl -fsS --max-time 5 "$url" >/dev/null
done`,
        },
        subsections: [
          {
            id: 'glob-loop',
            title: 'Loop over files',
            body: [
              'If a Bash glob matches nothing, it normally remains as literal text. **`[[ -e "$file" ]] || continue`** safely skips that no-match value.',
            ],
            code: {
              language: 'shell',
              code: `for file in /var/log/order/*.log; do
  [[ -e "$file" ]] || continue
  echo "$file: $(wc -l < "$file") lines"
done`,
            },
          },
          {
            id: 'while-read',
            title: 'Read a file line by line',
            body: [
              '**`IFS= read -r`** is the safe standard shape: an empty `IFS` preserves leading and trailing spaces, and `-r` keeps backslashes literal. The final condition also processes a last line that lacks a newline.',
            ],
            code: {
              language: 'shell',
              code: `while IFS= read -r url || [[ -n "$url" ]]; do
  [[ -z "$url" || "$url" == \\#* ]] && continue
  curl -fsS --max-time 5 "$url" >/dev/null
done < endpoints.txt`,
            },
          },
        ],
      },
      {
        id: 'functions',
        title: 'Functions: name a reusable step',
        body: [
          'A function groups commands under a name. Function arguments use the same `$1`, `$2`, and `"$@"` variables as script arguments, but they refer to the function call while the function is running. Declare variables with **`local`** so they do not accidentally overwrite script-wide values.',
        ],
        code: {
          language: 'shell',
          code: `check_url() {
  local url="$1"
  local timeout="\${2:-5}"

  if curl -fsS --max-time "$timeout" "$url" >/dev/null; then
    printf 'OK   %s\\n' "$url"
  else
    printf 'FAIL %s\\n' "$url" >&2
    return 1
  fi
}

check_url "http://127.0.0.1:8080/health" 3`,
        },
      },
      {
        id: 'strict-mode',
        title: 'Safer failure handling',
        body: [
          '**`set -u`** treats an unset variable as an error. **`set -o pipefail`** makes a pipeline fail when any stage fails, not only the last one. **`set -e`** exits after many unhandled command failures, but has exceptions in tests, `&&` / `||` lists, and other shell grammar.',
          'Together, **`set -Eeuo pipefail`** is a useful baseline for small operational scripts when you understand those rules. It is not a replacement for explicit `if` statements where failure is expected and needs a message or recovery.',
        ],
        code: {
          language: 'shell',
          code: `set -Eeuo pipefail

trap 'echo "error on line $LINENO" >&2' ERR

if ! curl -fsS --max-time 5 "$url" >/dev/null; then
  echo "health check failed: $url" >&2
  exit 1
fi`,
        },
        callout: {
          kind: 'warn',
          title: 'Do not add set -e blindly',
          body: [
            'Commands that are allowed to fail should be placed in `if`, `! command`, or an explicit `||` handler. Test the script’s failure paths, not only its success path.',
          ],
        },
      },
      {
        id: 'complete-script',
        title: 'Put it together: a health-check script',
        body: [
          'This version accepts any number of endpoints, prints one result per endpoint, and returns failure if at least one check fails. It keeps checking after an individual failure so the operator gets the full picture.',
        ],
        code: {
          language: 'shell',
          filename: 'health-check.sh',
          code: `#!/usr/bin/env bash
set -u
set -o pipefail

if (( $# == 0 )); then
  echo "usage: $0 URL [URL ...]" >&2
  exit 2
fi

failures=0

check_url() {
  local url="$1"

  if curl -fsS --max-time 5 "$url" >/dev/null; then
    printf '%s OK   %s\\n' "$(date -Is)" "$url"
  else
    printf '%s FAIL %s\\n' "$(date -Is)" "$url" >&2
    (( failures += 1 ))
  fi
}

for url in "$@"; do
  check_url "$url"
done

if (( failures > 0 )); then
  echo "$failures check(s) failed" >&2
  exit 1
fi`,
        },
        after: [
          'Run it directly, redirect its output from cron, or call it from a systemd unit. The **exit status** is the machine-readable result; the timestamped lines are the human-readable evidence.',
        ],
      },
      {
        id: 'debug-test',
        title: 'Check and debug a script',
        body: [
          '**`bash -n`** parses a script without running it and catches syntax errors. **`bash -x`** prints expanded commands before executing them; use it carefully because expanded secrets can appear in terminal output or logs. **ShellCheck** adds static warnings for common quoting, test, and portability mistakes.',
        ],
        code: {
          language: 'shell',
          code: `bash -n health-check.sh       # syntax check only
shellcheck health-check.sh    # if ShellCheck is installed
bash -x health-check.sh http://127.0.0.1:8080/health

PS4='+ \${BASH_SOURCE}:\${LINENO}: '
bash -x health-check.sh       # trace with file and line number`,
        },
      },
      {
        id: 'interactive-vs-script',
        title: 'Interactive shell versus script',
        body: [
          '**`~/.bashrc`** configures interactive Bash sessions: aliases, prompt (`PS1`), completion, and shell options for your own terminal. A non-interactive script does not normally read it and should not depend on aliases or a person’s custom `PATH`.',
          'Set required variables in the script, pass them as arguments or environment variables, or load a deliberate configuration file. Use full paths when a restricted environment such as cron or systemd may have a smaller `PATH`.',
        ],
        code: {
          language: 'shell',
          code: `# Interactive convenience in ~/.bashrc:
alias ll='ls -alF'

# Script input from the environment, with a default:
APP_PORT="\${APP_PORT:-8080}"

# Deliberately load a trusted config file:
source /etc/order-processor/health-check.conf`,
        },
        callout: {
          kind: 'warn',
          title: 'Source only trusted files',
          body: [
            '`source file` executes that file as shell code in the current script. It is not a general parser for untrusted key/value input.',
          ],
        },
      },
      {
        id: 'bash-quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Goal', 'Syntax'],
          rows: [
            ['Choose Bash', '`#!/usr/bin/env bash`'],
            ['Make / run a script', '`chmod +x script.sh`, `./script.sh`'],
            ['Expand safely', '`"$var"`, `"${var}_suffix"`, `"$(command)"`'],
            ['Read arguments', '`$1`, `${1:-default}`, `"$@"`, `$#`'],
            ['Test a command', '`if command; then ... else ... fi`'],
            ['Test values / files', '`[[ ... ]]`, `(( ... ))`'],
            ['Loop over values', '`for item in "$@"; do ...; done`'],
            ['Read lines safely', '`while IFS= read -r line; do ...; done < file`'],
            ['Define a function', '`name() { local value="$1"; ...; }`'],
            ['Fail explicitly', '`echo "message" >&2; exit 1`'],
            ['Check / trace', '`bash -n script`, `shellcheck script`, `bash -x script`'],
          ],
        },
      },
    ],
    takeaways: [
      'A script is a repeatable command sequence: add a **shebang**, make it executable, and return meaningful **exit statuses** for callers.',
      'Quote expansions as **`"$var"`** and pass collections as **`"$@"`**; use defaults or explicit usage errors for missing arguments.',
      'Use **`if`**, **`[[ ... ]]`**, loops, and functions to express decisions and repetition while keeping expected failures explicit.',
      '**`set -u`** and **`pipefail`** catch common mistakes; use **`set -e`** only with an understanding of its exceptions.',
      'Validate with **`bash -n`** and **ShellCheck**, debug carefully with **`bash -x`**, and keep production scripts independent of interactive `.bashrc` customizations.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      { challengeId: 'linux-23-script-the-health-check', label: 'Script the Health Check' },
      { challengeId: 'linux-24-loop-over-order-batches', label: 'Loop Over Order Batches' },
    ],
  },
];
