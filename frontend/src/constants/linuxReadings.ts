/** Linux track readings (blogs) interleaved with labs. Same shape as the Kubernetes readings. */

import { PLAY_DOMAINS } from './playCatalog';
import type { K8sReading, K8sTrackItem } from './k8sReadings';
import { LINUX_READINGS_EXTENDED } from './linuxReadingsExtended';
import terminalShellKernelImg from '../assets/linux-readings/meet-your-linux-machine/terminal-shell-kernel.png';
import filesystemTreeImg from '../assets/linux-readings/meet-your-linux-machine/filesystem-tree.png';
import absoluteVsRelativeImg from '../assets/linux-readings/meet-your-linux-machine/absolute-vs-relative.png';
import globExpansionImg from '../assets/linux-readings/files-and-folders/glob-expansion.png';
import findFunnelImg from '../assets/linux-readings/files-and-folders/find-funnel.png';
import findExecImg from '../assets/linux-readings/files-and-folders/find-exec.png';

export const LINUX_LABS_PATH = '/track/devops-engineer/linux';
export const LINUX_READINGS_BASE = `${LINUX_LABS_PATH}/read`;

export function linuxReadingPath(slug: string): string {
  return `${LINUX_READINGS_BASE}/${slug}`;
}

export const LINUX_READINGS: K8sReading[] = [
  {
    id: 'meet-your-linux-machine',
    slug: 'meet-your-linux-machine',
    trackId: 'B0',
    eyebrow: 'Linux from zero',
    title: 'Meet Linux',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-00-first-shift-on-the-order-box',
    lede:
      'Start here if you are asking **what Linux is** and where it shows up in real life. No prior experience needed: we define Linux in plain language, give concrete examples, then map what you will see on a server (prompt, folders, paths). Commands come in the next readings.',
    sections: [
      {
        id: 'what-is-linux',
        title: 'What is Linux?',
        body: [],
        subsections: [
          {
            id: 'linux-as-an-os',
            title: 'Linux as an operating system',
            body: [
              '**Linux is an operating system (OS)** — the software that sits between you and the hardware. It runs applications, stores files on disk, uses the network, and drives the screen and keyboard. **Windows** and **macOS** are other operating systems you may already use every day; **Linux** is another major family, widely used where reliability and flexibility matter.',
              'In everyday conversation, **“Linux”** usually means a complete system you can use — applications, folders, users, and settings — the same kind of thing you mean when you say you use **Windows** or **Mac**. People talk that way all the time: “I’m on a Windows machine,” “mine’s a Mac,” or “I run Linux on my laptop.” Same idea: **which system** you are using, not the kernel’s name in isolation.',
            ],
          },
          {
            id: 'kernel-distro-open-source',
            title: 'Kernel, distro, and open source',
            body: [
              'Under the hood, the piece that does the heavy lifting is the **kernel** — it schedules applications on the CPU, uses memory, reads and writes the disk, and handles the network. **Linux** is the name of that kernel.',
              'You rarely install “only the kernel.” What you download or get on a cloud machine is a **distribution** (**distro**): the kernel **plus** the rest of the stack — command-line tools, installers, default packages, and docs. **Ubuntu**, **Debian**, **Fedora**, and **Alpine** are distros; they share the same core ideas and differ in what ships by default and how you install software.',
              'Linux is **free and open source**: anyone can read, modify, and redistribute the kernel and much of the software around it. Companies build products on top of it — Android, cloud platforms, appliances — instead of writing an OS from scratch.',
            ],
          },
        ],
        callout: {
          kind: 'idea',
          title: 'You have heard “server” many times. What is it?',
          body: [
            'A **server** is just a computer whose job is to **serve others** — websites, apps, databases — over the network, all day, every day. It usually sits in a data center with **no screen or keyboard**; people connect to it remotely and work through a **text prompt**.',
            'Most servers run **Linux**, and that is the Linux this track teaches.',
          ],
        },
      },
      {
        id: 'linux-in-the-wild',
        title: 'Linux in the wild: examples',
        body: [
          'You may already depend on Linux without seeing a “Linux desktop.” Concrete places it shows up:',
        ],
        table: {
          headers: ['Example', 'What Linux is doing', 'What you usually see'],
          rows: [
            [
              '**Android phone**',
              'The **Linux kernel** runs the device (CPU, memory, drivers).',
              'Android apps and settings — not a Linux login screen.',
            ],
            [
              '**Websites and APIs** (streaming, shopping, banking)',
              'Often run on **Linux servers** in a data center.',
              'The website or app — not the server OS.',
            ],
            [
              '**Cloud “virtual machines”**',
              'Many instances are **Ubuntu**, **Debian**, or similar distros.',
              'A dashboard in AWS/GCP/Azure; you SSH into a text prompt.',
            ],
            [
              '**Wi‑Fi router, smart TV, Raspberry Pi**',
              '**Embedded Linux** — small, fixed-purpose systems.',
              'The device’s own UI or no UI at all.',
            ],
            [
              '**Your laptop (maybe)**',
              'Some developers run **Linux desktop**; many use Windows or Mac.',
              'That is fine — this course gives you a **remote Linux lab** in the browser.',
            ],
          ],
        },
        after: [
          '**Takeaway:** “Linux” is not one product like “Windows 11.” It is a kernel and an ecosystem. You may use Linux **inside** a phone or website without ever seeing a Linux desktop. On this track you will mostly work on a **Linux server** you reach over the network.',
        ],
      },
      {
        id: 'parallels',
        title: 'Parallels: if you know Windows or Mac',
        body: [
          'Linux is not from another planet — many ideas match what you already use; labels and defaults differ.',
          'This table compares **desktop habits** on Windows or Mac to a **Linux server** (the kind you reach over the network for ops work). **Linux on a laptop with a desktop** — Ubuntu, Fedora, and other distros with icons and a browser — feels closer to the Windows/Mac column. **This reading** emphasizes the **Linux server** column because that is what production ops and the hands-on labs on this track use.',
        ],
        table: {
          headers: ['Idea', 'Windows (roughly)', 'macOS (roughly)', 'Linux server'],
          rows: [
            ['Desktop and apps', 'Start menu, File Explorer', 'Finder, Dock', 'Often **none** — connect over the network and use a shell'],
            ['Where files live', '`C:\\`, `D:\\` drive letters', '`/Users/you` under one disk', '**One tree** from `/` — no `C:` or `D:`'],
            ['System settings', 'Registry, `Program Files`', '`/Library`, Unix `/etc` on disk', 'Mostly plain files under **`/etc`**'],
            ['Your personal files', '`C:\\Users\\You`', '`/Users/you`', '**`/home/you`**'],
            ['Logs and changing data', 'Event Viewer, AppData', 'Console, `~/Library/Logs`', '**`/var/log`**, **`/var`**'],
            ['Run something', 'Double-click an `.exe`', 'Open an `.app` or Terminal', 'Type a **command**; the shell finds the application'],
          ],
        },
        after: [
          'Many Linux **servers** (and other Linux machines you use remotely) **do not show a desktop**. There is no Start menu or file browser on the screen — you work through a **shell**, a text interface. Day-to-day ops happens there.',
          'When you **connect** to such a machine, you typically get a **text prompt** and one **folder tree** you navigate with commands (covered in the next sections). In a lab, DevSetu opens that connection for you in the browser.',
        ],
      },
      {
        id: 'terminal-shell-kernel',
        title: 'Inside a Linux machine: kernel, shell, terminal',
        body: [
          'Three layers sit between you and the hardware on any Linux machine. Picture them from the **outside in**: you type into the **terminal**, the **shell** works out what you meant, and the **kernel** does the actual work.',
        ],
        subsections: [
          {
            id: 'terminal',
            title: 'Terminal: the window you type into',
            body: [
              'The **terminal** is the text window: it shows characters and sends your keystrokes along. It does **not** understand commands itself — type `ls` and the terminal just passes the letters `l`, `s` and Enter to the program running inside it, then draws whatever text comes back.',
              'The name comes from old **hardware terminals**: a screen and keyboard wired to a big shared computer in another room. Today it is an app — **Terminal** or **iTerm** on a Mac, **Windows Terminal** on Windows, the panel on the right in a DevSetu lab. When you connect to a server, the terminal is on **your** laptop, but the commands run on the **server**.',
            ],
          },
          {
            id: 'shell',
            title: 'Shell: the program that understands your commands',
            body: [
              'The **shell** is the program running inside the terminal. It prints the **prompt**, waits for a line, and when you press Enter it reads the line, splits it into words, expands shortcuts like `~` (your home folder) and `*` (matching file names), finds the program you named (for example `/usr/bin/ls`), and asks the kernel to start it. When that program finishes, the shell prints the prompt again.',
              'It also gives you comforts on top: **command history** (Up arrow), **Tab completion** for commands and paths, **variables**, and **scripts** — a file of commands the shell runs top to bottom. The most common shell on Linux servers is **bash**; others include **zsh** (the macOS default) and the minimal **sh**. They all work the same basic way.',
            ],
          },
          {
            id: 'kernel',
            title: 'Kernel: the part that touches the hardware',
            body: [
              'The **kernel** is the core of Linux. It starts and stops programs, gives them memory and CPU time, reads and writes files on disk, and talks to the network. No program — not even the shell — touches the hardware directly; they all ask the kernel.',
            ],
          },
        ],
        figure: {
          image: terminalShellKernelImg,
          imageAlt:
            'Hand-drawn sketch: a person types into a terminal; inside it the shell reads the line and the kernel runs programs and reads files',
          caption: 'You type in the terminal; the shell interprets; the kernel does the work.',
          flush: true,
        },
        after: [
          'After you connect, you typically see a **prompt** — a line of text and a blinking cursor, for example `student@linux-lab:~$`. It is the shell telling you who you are, which machine you are on, and which folder you are in. The `$` means a normal user; `#` would mean the superuser account (**root**), so treat that with extra care.',
        ],
        tableAfter: {
          headers: ['Prompt part', 'Meaning'],
          rows: [
            ['`student`', 'The user you are logged in as'],
            ['`@linux-lab`', 'The machine (hostname)'],
            ['`~`', 'The current folder; `~` is shorthand for your home directory, e.g. `/home/student`'],
            ['`$`', 'Normal user ( `#` = root )'],
          ],
        },
      },
      {
        id: 'filesystem-map',
        title: 'One filesystem: a single tree from /',
        body: [
          'On **Windows**, **`C:`** and **`D:`** are **drive letters** — different disks or partitions get different letters, and paths look like `C:\\Users\\You\\file.txt`. Linux does **not** use drive letters. Everything hangs from one root folder, written `/`. Extra disks are attached **inside** that tree (called **mounting**, covered later), so you still see one hierarchy of folders.',
          'Each top-level folder has a conventional job. Learn these once and you can guess where things live on almost any Linux machine.',
        ],
        figure: {
          image: filesystemTreeImg,
          imageAlt:
            'Hand-drawn tree: the root folder / with branches to /etc, /home, /var, /opt, /tmp, /usr, /dev and /proc',
          caption: 'One tree. Every folder has a job.',
          flush: true,
        },
        tableAfter: {
          headers: ['Folder', 'What it is for', 'Examples'],
          rows: [
            [
              '`/etc`',
              'System and service **configuration** (plain text)',
              '`/etc/hostname`, `/etc/ssh/sshd_config`',
            ],
            [
              '`/home`',
              'Each **user’s** own files and settings',
              '`/home/student/notes.txt`, `~/.ssh`',
            ],
            [
              '`/var/log`',
              '**Logs** written while the system runs',
              '`/var/log/syslog`, `/var/log/nginx/access.log`',
            ],
            [
              '`/opt`',
              'Optional **third-party** applications',
              'Vendor bundles under `/opt/myapp/`',
            ],
            [
              '`/tmp`',
              '**Temporary** files (may be deleted on reboot)',
              'Short-lived exports, installer scratch',
            ],
            [
              '`/usr/bin`',
              'User-facing **commands** the shell runs',
              '`ls`, `grep`, `python3`',
            ],
            [
              '`/proc`',
              'Live view of **processes** and kernel stats',
              '`/proc/uptime`, one folder per running process',
            ],
          ],
        },
        callout: {
          kind: 'scope',
          title: 'Everything is a file',
          body: [
            'Linux exposes a lot of the system as files: devices under `/dev`, process information under `/proc`, and so on. That single idea is why the same few tools can inspect so many different things — you will use them in later readings and labs.',
          ],
        },
      },
      {
        id: 'paths',
        title: 'Paths: absolute and relative',
        body: [
          'A **path** is directions to a file or folder. **Absolute** paths start at `/` and spell the full route, e.g. `/var/log/app.log`. They mean the same thing no matter which folder you are standing in — like `C:\\Users\\Alice\\file.txt` on Windows always pointing to the same place.',
          '**Relative** paths start from your **current folder**. From `/var/lib`, the same log might be written `../log/app.log` (`..` means one folder up). That depends on where you are, like a path relative to whichever folder File Explorer is showing.',
        ],
        figure: {
          image: absoluteVsRelativeImg,
          imageAlt:
            'Hand-drawn comparison: absolute path /var/log/app.log from the root, relative path ../log/app.log from /var/lib',
          caption: 'Absolute starts at the root. Relative starts where you stand.',
          flush: true,
        },
        table: {
          headers: ['Symbol', 'Meaning'],
          rows: [
            ['`/`', 'Root of the whole tree'],
            ['`~`', 'Your home directory'],
            ['`.`', 'The folder you are in now'],
            ['`..`', 'One folder up'],
          ],
        },
      },
      {
        id: 'saved-for-later',
        title: 'What we save for later',
        body: [
          'This reading stops at the map. Deliberately left for the next readings:',
        ],
        bullets: [
          'How commands are structured (program, options, arguments) and keyboard habits like Tab completion.',
          'Listing folders, reading files, and built-in help (`man`, `--help`).',
          'Copying, moving, finding files, and searching text in logs.',
          'Users, permissions, processes, systemd, and the rest of the track.',
        ],
        callout: {
          kind: 'tip',
          title: 'Help lives on the machine',
          body: [
            'Linux ships documentation with the system. You do not need to memorize every command — you need to know the map and where to look. **B1** and later posts show how.',
          ],
        },
      },
    ],
    takeaways: [
      '**Linux** is an **operating system** (kernel + tools); **distros** like Ubuntu package it for servers and desktops. You may already use it via **Android**, **websites**, or **cloud VMs** without seeing a Linux desktop.',
      'A **server** is a computer that runs services for others, often reached **remotely** through a text interface — not a desktop like your laptop.',
      'The **terminal** shows text and sends keystrokes; the **shell** (usually **bash**) reads your line, expands it, and starts programs; the **kernel** runs them and touches the hardware.',
      'Linux has **one tree from `/`** (no `C:`/`D:` drive letters). **`/etc`**, **`/home`**, **`/var/log`**, and **`/tmp`** are folders you will visit often.',
      'Paths can be **absolute** (from `/`) or **relative** (from where you stand); `~`, `.`, and `..` are shortcuts.',
      '**Commands** start in **B1** — this post is just the map.',
    ],
    relatedLabsIntro:
      'This post is a primer with no lab of its own. Continue with **B1 — Files and folders** when you are ready for commands.',
    relatedLabs: [],
  },
  {
    id: 'files-and-folders',
    slug: 'files-and-folders',
    trackId: 'B1',
    eyebrow: 'Linux from zero',
    title: 'Files and Folders: List, Organize, Find',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-01-organize-the-release-folder',
    lede:
      'You already have the map: prompt, shell, one tree from `/`, absolute and relative paths. This post is the next step — **commands** to see where you are, list what is in a folder, create and tidy files, and **find** things when they are not where you expect.',
    sections: [
      {
        id: 'from-b0',
        title: 'Where you left off',
        body: [
          'On a remote Linux **server**, you usually do not click through folders in a file browser. You connect in a **terminal** (the text window), type a line at the **prompt**, and the **shell** interprets it and starts programs; the **kernel** runs those programs and talks to disk and network — **executes here**, at the bottom of the stack.',
          'Files live in **one tree** starting at `/`. Your personal area is **`~`** (often `/home/you`). A **path** can be **absolute** — full directions from `/`, e.g. `/var/log/app.log` — or **relative** to the folder you are in now, e.g. `notes/today.txt` or `../config/app.conf`. This reading puts that map to work: **list** what is in a folder, **organize** files without losing any, and **search** the tree when something is not where you expect.',
        ],
        callout: {
          kind: 'tip',
          title: 'You do not need to memorize everything',
          body: [
            'Linux ships **help on the machine** (`--help`, `man`). Learn a small set of habits and know **where to look** when you forget a flag — memorizing every option is not the goal.',
          ],
        },
      },
      {
        id: 'how-commands-work',
        title: 'How a command line is built',
        body: [
          'Each line you type is roughly: **command**, then **options** (flags that change behavior), then **arguments** (paths, names, or other inputs). Options often start with a dash; a double dash (`--`) sometimes introduces a long option name.',
          'Commands like **`ls`**, **`cp`**, and **`mkdir`** are not magic built into the shell — each is a **program** on disk (usually under `/usr/bin`). Linux gives you a small, consistent **interface**: type a name, pass flags and paths, read the result. The implementations are ordinary software; see the [GNU coreutils source](https://github.com/coreutils/coreutils/tree/master/src) (`ls.c`, `cp.c`, `mkdir.c`, and the rest).',
        ],
        table: {
          headers: ['Piece', 'Role', 'Example on one line'],
          rows: [
            [
              'Command',
              'Which **program** to run — the first word on the line',
              '`ls` lists names; `mkdir` creates a folder; `cp` copies',
            ],
            [
              'Options',
              'Short or long **flags** that change behavior (often after the command)',
              '`ls -l` adds size and dates; `mkdir -p` creates missing parents; `cp -i` asks before overwrite',
            ],
            [
              'Arguments',
              '**Operands** the command acts on — usually paths or names at the end',
              '`cd ~/projects` changes folder; `cp notes.txt backup.txt` names source and destination',
            ],
          ],
        },
        after: [
          'Try **`command --help`** for a short summary, or **`man command`** for the full manual (press `q` to quit). Tab completion is your friend: type the first letters of a command or path and press **Tab**; the shell fills in what it can or shows choices.',
        ],
        code: {
          language: 'shell',
          code: `pwd            # where am I?
cd ~/projects  # go to projects under my home folder
cd ..          # go up one folder
ls             # list this folder
ls -l          # list with size, owner, and date
ls --help      # built-in cheat sheet for ls`,
        },
      },
      {
        id: 'core-five',
        title: 'The core five: make, copy, move, delete',
        body: [
          'Most file housekeeping on a server is five commands. Each has one option you will reach for often:',
        ],
        table: {
          headers: ['Command', 'Does', 'The option you want'],
          rows: [
            ['`mkdir`', 'Makes a folder', '`-p`: make parents too, no error if it exists'],
            ['`cp`', 'Copies files', '`-r` for folders; `-a` to keep dates and permissions'],
            ['`mv`', 'Moves **or renames**', '`-i`: ask before overwriting'],
            ['`rm`', 'Deletes files', '`-r` for folders; `-i` to confirm each'],
            ['`rmdir`', 'Deletes an **empty** folder', 'Refuses if anything is inside: a safe check'],
          ],
        },
        codes: [
          {
            language: 'shell',
            code: `mkdir -p ~/projects/docs        # make a folder; -p adds missing parents
touch ~/projects/docs/todo.txt  # create an empty file
cp notes.txt notes-backup.txt   # copy: both files now exist
cp -r docs/ docs-old/           # copy a whole folder
mv draft.txt final.txt          # rename (a move in the same folder)
mv final.txt ~/projects/docs/   # move into another folder
rm scratch.tmp                  # delete a file (no recycle bin)
rmdir ~/projects/old            # delete a folder, only if it is empty`,
          },
        ],
        after: [
          'On the same disk, **`mv`** usually just updates which folder lists the name — fast even for large files. Across disks it may copy then delete. Use **`cp -p`** when you need the copy to stay **executable** or keep the same timestamps; use **`cp -a`** for whole folder trees (archive mode). Plain **`cp`** is fine when those details do not matter.',
        ],
        callout: {
          kind: 'warn',
          title: 'There is no recycle bin',
          body: [
            '`rm` deletes immediately, and `rm -r` removes a folder and **everything inside it** (the whole folder tree under that name — not “the whole disk,” just that branch). `mv` and `cp` silently overwrite a file with the same name. Look before you act: run `ls` with the same names first, and use `-i` when you are unsure.',
          ],
        },
      },
      {
        id: 'globs',
        title: 'Globs: patterns the shell expands',
        body: [
          'A **glob** is a **filename pattern** — wildcards like `*` and `?` that stand in for part of a name, so you can name a whole group of files at once instead of typing each one. The important part is *who* expands it: the **shell**, before the command runs. The command only sees the finished list of names.',
          'For the examples below, picture a folder with these files: `report.pdf`, `slides.pdf`, `notes.txt`, `2024-summary.txt`, `photo-1.jpg`, `photo-2.jpg`, and `photo-10.jpg`.',
        ],
        table: {
          headers: ['Pattern', 'What it matches', 'Example (you type → shell expands to)'],
          rows: [
            [
              '`*`',
              'Any characters in that spot, including none — “anything here”',
              '`*.pdf` → `report.pdf` `slides.pdf`',
            ],
            [
              '`?`',
              'Exactly **one** character',
              '`photo-?.jpg` → `photo-1.jpg` `photo-2.jpg` (not `photo-10.jpg`, which has two characters there)',
            ],
            [
              '`[12]`, `[0-9]`',
              'Exactly one character, chosen from the set or range in the brackets',
              '`photo-[12].jpg` → `photo-1.jpg` `photo-2.jpg`',
            ],
            [
              '`[!0-9]`',
              'Exactly one character that is **not** in the set. A `!` right after `[` flips the set: `[0-9]` is “any digit”, `[!0-9]` is “anything except a digit”',
              '`[!0-9]*.txt` → `notes.txt` (first character must not be a digit, so `2024-summary.txt` is left out)',
            ],
            [
              '`{a,b}`',
              '**Brace expansion**: not a match against files — the shell simply writes the word out once for **each** option inside the braces, whether or not such files exist',
              '`mkdir {jan,feb,mar}` → `mkdir jan feb mar`; `*.{pdf,txt}` → `*.pdf *.txt` → `report.pdf` `slides.pdf` `notes.txt` `2024-summary.txt`',
            ],
          ],
        },
        figure: {
          image: globExpansionImg,
          imageAlt:
            'Hand-drawn flow: you type cp *.jpg photos/, the shell expands it to cp fox.jpg owl.jpg deer.jpg photos/, then cp copies',
          caption: 'You write a pattern. The shell writes the list. The command never sees the star.',
          flush: true,
        },
        after: [
          '**`[!...]` in more detail:** the brackets always stand for **exactly one** character. Without `!`, that character must be one of the ones listed; with `!` as the first thing inside, it must be anything **except** those. So `[!0-9]*` reads as “one non-digit, then anything” — every name that does not start with a number.',
          '**`{a,b}` in more detail:** braces are about **building words**, not finding files. The shell copies the text around the braces once per comma-separated option: `report.{pdf,txt}` becomes `report.pdf report.txt` even if neither file exists. That makes braces handy for creating several folders at once, and when the result contains a glob (`*.{pdf,txt}` → `*.pdf *.txt`), each glob is then expanded as usual.',
        ],
        code: {
          language: 'shell',
          code: `ls *.pdf             # report.pdf  slides.pdf
ls photo-?.jpg       # photo-1.jpg  photo-2.jpg
ls photo-[12].jpg    # photo-1.jpg  photo-2.jpg
ls [!0-9]*.txt       # notes.txt  (2024-summary.txt starts with a digit)
ls *.{pdf,txt}       # report.pdf  slides.pdf  notes.txt  2024-summary.txt
mkdir {jan,feb,mar}  # runs: mkdir jan feb mar`,
        },
        callout: {
          kind: 'warn',
          title: 'Three things that trip everyone up',
          body: [
            '**Case matters**: `*.pdf` does not match `Slides.PDF`. **Hidden files are skipped**: `*` does not match names starting with a dot. **No match, no expansion**: if nothing matches, bash passes the pattern through unchanged and you get `cannot stat \'*.png\': No such file or directory`.',
            'Before **`rm`** or **`mv`** with a glob, run **`ls`** with the same pattern so you see the list first.',
          ],
        },
      },
      {
        id: 'quoting',
        title: 'Quoting: spaces and special characters',
        body: [
          'The shell splits your line into **words** at every space — that is how it finds the command and its arguments. A file named **`holiday photo.jpg`** becomes **two** words (`holiday` and `photo.jpg`) unless you **quote** or **escape** the space.',
          'The table below is about **how the shell reads each style** before your command runs. “Expands `$var`?” means: if you stored a path in a variable, does the shell substitute it? “Expands globs?” means: does `*` turn into a list of matching files in the **current** folder?',
        ],
        table: {
          headers: ['Style', 'Expands `$var`?', 'Expands globs?', 'When to use it'],
          rows: [
            [
              '`\'single quotes\'`',
              'No — everything inside is literal',
              'No — `*` stays a star',
              'Awkward file names: spaces, `$`, `*` exactly as typed',
            ],
            [
              '`"double quotes"`',
              'Yes — `$HOME` becomes your path',
              'No — safe to hold a variable path with spaces',
              'Almost always for `"$file"` when `file` comes from a variable',
            ],
            [
              '`\\` escape',
              'No',
              'No',
              'One special character, e.g. a space in an otherwise plain name',
            ],
            [
              'No quotes',
              'Yes',
              'Yes — `*.pdf` may expand here',
              'Simple one-word names and intentional globs only',
            ],
          ],
        },
        code: {
          language: 'shell',
          code: `mv 'holiday photo.jpg' ~/pictures/  # single quotes: one name
mv holiday\\ photo.jpg ~/pictures/   # backslash escapes the space
img='holiday photo.jpg'             # store the name in a variable
mv "$img" ~/pictures/               # double quotes keep it one name`,
        },
        callout: {
          kind: 'warn',
          title: 'Always quote variables',
          body: [
            'Writing `$file` without quotes works until the day a name contains a space, and then the command acts on the wrong files. Make `"$file"` a reflex.',
          ],
        },
      },
      {
        id: 'what-is-find',
        title: 'What is find?',
        body: [
          'Globs only look in **one folder**. When a file might be anywhere under your home folder, deep inside **`~/projects`**, or in a scratch area like **`/tmp`**, you need a tool that **walks** from a starting folder down through subfolders and filters each path. That tool is **`find`**.',
          'Every **`find`** line has the same shape: **where** to start, **tests** each path must pass, and an **action** (printing paths is the default). The funnel picture is that idea: every file under the start folder is checked; only paths that pass all tests are kept.',
        ],
        figure: {
          image: findFunnelImg,
          imageAlt:
            'Hand-drawn funnel: every file in the folder falls through filters for name, size and age; two matches come out',
          caption:
            'Example: `find ~/projects -type f -size +1M -mtime -7` — start at `~/projects`, keep only **files** (`-type f`) larger than 1 MiB (`-size +1M`) touched in the last 7 days (`-mtime -7`).',
          flush: true,
        },
        table: {
          headers: ['Test', 'What it checks', 'Example (what it means)'],
          rows: [
            [
              '`-name` / `-iname`',
              'File name matches a pattern (`i` = ignore case)',
              '`-iname \'*.pdf\'` → names ending in `.pdf` or `.PDF` anywhere in the tree',
            ],
            [
              '`-type`',
              'Kind of path: `f` file, `d` directory, `l` symlink',
              '`-type f` → skip folders; only regular files',
            ],
            [
              '`-size`',
              'File size; `+` bigger than, `-` smaller than',
              '`-size +10M` → larger than 10 megabytes',
            ],
            [
              '`-mtime`',
              'Last **content** change, in days; sign like `-size`',
              '`-mtime -7` → changed within the last week',
            ],
            [
              '`-newer`',
              'Modified more recently than another file’s timestamp',
              '`-newer backup.stamp` → edited after you created the stamp file',
            ],
            [
              '`-user` / `-group`',
              'Owner user or group on disk',
              '`-user student` → files owned by `student`',
            ],
            [
              '`-empty`',
              'Zero-byte file or directory with nothing inside',
              '`-type d -empty` → empty folders',
            ],
            [
              '`-maxdepth`',
              'Do not descend past N levels below the start path',
              '`-maxdepth 1` → this folder only, no subfolders',
            ],
          ],
        },
        code: {
          language: 'shell',
          code: `find ~/projects -type f -size +1M -mtime -7   # files over 1 MiB changed this week
find ~ -iname '*.pdf'                          # every PDF under my home folder
find /tmp -type d -empty                       # empty folders in /tmp`,
        },
        after: [
          'Quote patterns (`-name \'*.pdf\'`) so the shell does not expand `*` in your **current** folder first. Tests combine with **AND** by default; use `-o` for OR and `!` for NOT, with `\\(` `\\)` around groups when the shell would otherwise steal the parentheses.',
        ],
      },
      {
        id: 'find-actions',
        title: 'Acting on what you find',
        body: [
          'Printing paths is the default **action**. The point of filtering first is that you can **keep working on that same set**: run another command on each match (`-exec`), delete them (`-delete`), or copy them — instead of copying paths by hand. Think of **`find`** as “build a list, then do something with the list.”',
        ],
        figure: {
          image: findExecImg,
          imageAlt:
            'Hand-drawn sketch: find results a.raw b.raw c.raw fed into the template mv {} rejects/, producing one mv per file',
          caption: '{} is replaced by each file. Print first, act second.',
          flush: true,
        },
        table: {
          headers: ['Action', 'Does', 'Note'],
          rows: [
            ['`-print`', 'Prints each path', 'The default'],
            ['`-delete`', 'Deletes each match', 'Put it last; test with `-print` first'],
            ['`-exec cmd {} \\;`', 'Runs `cmd` once per file', '`{}` becomes the path'],
            ['`-exec cmd {} +`', 'Runs `cmd` with many files at once', 'Faster; `{}` must come last'],
            ['`-ok cmd {} \\;`', 'Like `-exec`, but asks first', 'Good for risky commands'],
          ],
        },
        code: {
          language: 'shell',
          code: `find ~/projects -name '*.tmp'                                   # 1. look
find ~/projects -name '*.tmp' -exec rm {} \\;                    # 2. delete each match
find ~/Downloads -name '*.pdf' -exec cp {} ~/projects/docs/ \\;  # copy each PDF into docs`,
        },
        callout: {
          kind: 'warn',
          title: 'Run it without the action first',
          body: [
            'A `find` that deletes or moves the wrong files does it to all of them, instantly. Run the same command with just the tests, read the list, then add `-delete` or `-exec`.',
          ],
        },
      },
      {
        id: 'when-not-find',
        title: 'When find is not enough',
        body: [
          '**`find`** is for “which **paths** match these rules?” Other questions need different tools. The third column explains why **`find`** is or is not the right first choice.',
        ],
        table: {
          headers: ['Need', 'Use find?', 'Why', 'Reach for instead'],
          rows: [
            [
              'Files by name, size, age, or owner anywhere under a folder',
              'Yes',
              'It walks the tree and tests each file — exactly what **`find`** is for',
              '`find ~/projects -type f -size +1M`',
            ],
            [
              'Files in **one** folder matching `*.pdf`',
              'Overkill',
              'You already know the folder; a glob is shorter and faster to type',
              '`ls *.pdf` or `mv *.pdf docs/`',
            ],
            [
              'Files **containing** certain text inside',
              'No',
              '**`find`** sees names and metadata, not file contents',
              '`grep -r` (covered in the next reading)',
            ],
            [
              'Total disk space used by a folder',
              'No',
              '**`find`** lists paths; it does not add up sizes for one summary',
              '`du -sh ~/projects`',
            ],
            [
              'Instant name lookup across the whole disk',
              'Often too slow',
              '**`find`** scans live every time; an index can answer in milliseconds if your admin installed one',
              '`locate filename` (when available)',
            ],
          ],
        },
      },
      {
        id: 'more-of-the-map',
        title: 'Quick reference',
        body: [
          'Keep this table handy; **`man`** and **`--help`** fill in the rest. Heavier tools (**`rsync`**, links, **`xargs`**) show up later on the track.',
        ],
        tableAfter: {
          headers: ['Task', 'Command'],
          rows: [
            ['Where am I / go there', '`pwd`, `cd path`'],
            ['List a folder', '`ls`, `ls -l`'],
            ['Make nested folders', '`mkdir -p a/b/c`'],
            ['Copy keeping mode/time', '`cp -p file dest/`'],
            ['Copy a folder tree', '`cp -a src/ dest/`'],
            ['Rename or move', '`mv old new`'],
            ['Preview a glob', '`ls *.pdf`'],
            ['Find by tests', '`find ~/projects -type f -name \'*.pdf\'`'],
            ['Act on matches', '`find ... -exec cmd {} \\;`'],
          ],
        },
      },
    ],
    takeaways: [
      'A command line is **command + options + arguments**; **`pwd`**, **`cd`**, and **`ls`** orient you; **`--help`** / **`man`** and **Tab** completion cover the rest. File commands are **programs** (e.g. GNU coreutils), not shell builtins.',
      'Five commands handle most file work: **`mkdir -p`**, **`cp`** (**`-p`** / **`-a`**), **`mv`** (also rename), **`rm`**, **`rmdir`**. There is **no recycle bin** — **`rm -r`** removes a whole **folder tree** under that name; preview with **`ls`**, or use **`-i`**, before destructive steps.',
      '**Globs** are expanded by the **shell** before the program runs; quote names with spaces and always write **`"$var"`**.',
      '**`find`** walks from a starting path with tests (name, type, size, age, owner); run the same query **without** **`-delete`** / **`-exec`** until the match list looks right.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      {
        challengeId: 'linux-01-organize-the-release-folder',
        label: 'Organize the Release Folder',
      },
      {
        challengeId: 'linux-02-find-the-misplaced-configs',
        label: 'Find the Misplaced Configs',
      },
    ],
  },
  {
    id: 'reading-and-searching-text',
    slug: 'reading-and-searching-text',
    trackId: 'B2',
    eyebrow: 'Work with text files',
    title: 'Read, Edit and Search Text: less, tail, vi, grep',
    showBlogStamp: true,
    gatedByChallengeId: 'linux-03-read-the-order-logs',
    lede:
      'Logs, configs, and scripts on a Linux server are all **plain text files**, and most of the work comes down to three jobs: **read** them, **edit** them, and **search** them. This post covers the tools for each — **`less`** and **`tail`** to read, **`vi`** and **`sed`** to edit, **`grep`** to search.',
    sections: [
      {
        id: 'viewing-overview',
        title: 'Read: look inside a text file',
        body: [
          'A text file can be a few lines, like a note or a config, or millions of lines, like a **log file** that a program keeps adding to. Linux has a small tool for each way of looking at it. The examples use **`file.txt`** — on a server it is often a log such as **`/var/log/app.log`**.',
        ],
        subsections: [
          {
            id: 'size-first',
            title: 'ls -lh and wc -l: check the size first',
            body: [
              'Before opening a file, find out how big it is. **`ls -lh`** shows the size in human units (**K**, **M**, **G**), and **`wc -l`** counts its lines. A 20-line file you can just print; a 2 GB log with ten million lines needs a different tool.',
            ],
            code: {
              language: 'shell',
              code: `ls -lh file.txt  # size, e.g. 2.1M
wc -l file.txt   # line count, e.g. 48213 file.txt`,
            },
          },
          {
            id: 'cat',
            title: 'cat: print the whole file',
            body: [
              '**`cat`** prints the entire file to the terminal in one go. That is perfect for short files like a config or a README.',
              'On a big file it is the wrong choice: thousands of lines scroll past faster than you can read, and you end up seeing only the last screenful.',
            ],
            code: {
              language: 'shell',
              code: `cat /etc/hostname  # a one-line file
cat notes.txt      # a short note`,
            },
          },
          {
            id: 'head-tail',
            title: 'head and tail: just the start or the end',
            body: [
              '**`head`** prints the first lines of a file and **`tail`** prints the last lines — 10 by default, or as many as you ask for with **`-n`**.',
              'Use **`head`** to see how a file starts (column names, the first events). Use **`tail`** for what happened **most recently** — new lines are added to the end of a log, so the latest events are always at the bottom.',
            ],
            code: {
              language: 'shell',
              code: `head file.txt        # first 10 lines
head -n 3 file.txt   # first 3 lines
tail file.txt        # last 10 lines
tail -n 50 file.txt  # last 50 lines`,
            },
          },
          {
            id: 'tail-f',
            title: 'tail -f: watch a file as it grows',
            body: [
              '**`tail -f`** (“follow”) prints the last lines and then **keeps waiting**: every time a program appends a new line, it appears on your screen straight away. This is how you watch a log live while you reproduce a problem.',
              'It never finishes on its own — press **Ctrl-C** to stop following and get your prompt back.',
            ],
            code: {
              language: 'shell',
              code: `tail -f /var/log/app.log         # print new lines as they arrive
tail -n 100 -f /var/log/app.log  # start with the last 100, then follow`,
            },
          },
          {
            id: 'less',
            title: 'less: scroll and search a big file',
            body: [
              '**`less`** opens a file in a scrollable window. It only reads the part you are looking at, so even a multi-gigabyte log opens instantly, and it never changes the file. When you are done, press **`q`** to quit back to the prompt.',
              '**Moving:** arrow keys go line by line, **Space** goes down a page and **`b`** goes back up a page. **`g`** jumps to the very start of the file and **`G`** to the very end.',
              '**Searching:** type **`/`** followed by a word and press Enter to search forward — every match is highlighted. **`n`** jumps to the next match and **`N`** to the previous one. **`?`** followed by a word searches backward.',
              '**Following:** press **`F`** to make **`less`** behave like **`tail -f`** and show new lines as they arrive. **Ctrl-C** stops following, so you can scroll back or search what just appeared.',
            ],
            code: {
              language: 'shell',
              code: `less file.txt             # open; q to quit
less -N file.txt          # show line numbers
less +G file.txt          # open at the end of the file
less +F /var/log/app.log  # open in follow mode`,
            },
          },
        ],
        table: {
          headers: ['Tool', 'What it does', 'Use it when…'],
          rows: [
            ['`ls -lh` / `wc -l`', 'Shows size / counts lines', 'Before opening any file you do not know'],
            ['`cat`', 'Prints the **whole** file', 'The file is short (a note, a config)'],
            ['`head -n N`', 'First **N** lines', 'You want to see how the file starts'],
            ['`tail -n N`', 'Last **N** lines', 'You want the **latest** lines'],
            ['`tail -f`', 'Last lines, then **keeps printing** new ones', 'A program is still writing to the file, e.g. a log'],
            ['`less`', 'Scrollable, searchable window on the file', 'You need to read or hunt inside a big file'],
          ],
        },
      },
      {
        id: 'vim-survival',
        title: 'Edit: vi',
        body: [
          '**`vi`** is the text editor found on practically every Linux machine; most systems actually run **`vim`** (“vi improved”) when you type **`vi`** — same keys. It works on any text file — notes, scripts, configs.',
          'It is not only for editing. People open files in **`vi`** just to **read** them (**`view file`** or **`vi -R file`** opens read-only, so you cannot change anything by accident), and to **create** new files: **`vi newfile.txt`** opens an empty buffer, and the file is created on disk the first time you save with **`:w`**.',
          'To practise editing, take a small config file, **`/etc/app/app.conf`**:',
        ],
        codes: [
          {
            language: 'ini',
            filename: 'app.conf',
            code: `PORT=8080
LOG_LEVEL=info
WELCOME=Hello!`,
          },
        ],
        after: [
          'Open it with **`vi /etc/app/app.conf`**. You start in **Normal** mode, where keys are commands, not text. Move to the **`WELCOME=`** line, press **`i`** to switch to **Insert** mode, and type. Press **Esc** to go back to Normal mode, then **`:wq`** to save and quit. If you make a mess, **`:q!`** quits without saving.',
        ],
        tableAfter: {
          headers: ['Goal', 'Keys'],
          rows: [
            ['Move around', 'Arrow keys or **`h j k l`**'],
            ['Start typing', '**`i`** (before cursor) or **`a`** (after)'],
            ['Back to Normal mode', '**Esc**'],
            ['Delete a line / undo', '**`dd`** / **`u`**'],
            ['Search', '**`/text`** then **`n`**'],
            ['Save and quit', '**`:wq`**'],
            ['Quit without saving', '**`:q!`**'],
          ],
        },
      },
      {
        id: 'sed-in-place',
        title: 'Edit: sed for one-line changes',
        body: [
          'For a single, predictable change in a text file you do not need an editor. **`sed`** applies an edit to every line and prints the result; **`s/old/new/`** means “replace **old** with **new**.” Without **`-i`** it only previews; with **`-i`** it writes the change into the file. Below it changes values in the same **`app.conf`**.',
        ],
        code: {
          language: 'shell',
          code: `sed 's/PORT=8080/PORT=9090/' /etc/app/app.conf                    # preview only: file unchanged
sed -i 's/PORT=8080/PORT=9090/' /etc/app/app.conf                 # write the change into the file
sed -i.bak 's/LOG_LEVEL=info/LOG_LEVEL=debug/' /etc/app/app.conf  # same, but keep app.conf.bak`,
        },
        tableAfter: {
          headers: ['Use', 'When'],
          rows: [
            ['**`vi`**', 'Several edits, or you need to read the file around the change'],
            ['**`sed -i`**', 'One predictable replacement, in a script, or across many files'],
          ],
        },
        callout: {
          kind: 'warn',
          title: 'Preview before -i',
          body: [
            'Run **`sed`** without **`-i`** first and check the output. A wrong pattern with **`-i`** changes the real file straight away.',
          ],
        },
      },
      {
        id: 'grep-basics',
        title: 'Search: grep',
        body: [
          '**`grep PATTERN FILE`** reads any text file line by line and prints only the lines that contain the pattern — the fastest way to answer “where does this appear?”. You will use it most on **log files**, so the examples search an application log, **`/var/log/app.log`**.',
        ],
        table: {
          headers: ['Option', 'What it does'],
          rows: [
            ['`-i`', 'Ignore upper/lower case'],
            ['`-v`', 'Invert: lines that do **not** match'],
            ['`-c`', 'Count matching lines'],
            ['`-n`', 'Show line numbers'],
            ['`-w`', 'Whole words only (`ERROR` but not `ERROR404`)'],
            ['`-r`', 'Search every file under a folder'],
            ['`-A` / `-B` / `-C` N', 'Show N lines after / before / around each match'],
            ['`-F`', 'Treat the pattern as plain text, no special characters'],
          ],
        },
        codes: [
          {
            language: 'shell',
            code: `grep ERROR /var/log/app.log               # lines containing ERROR
grep -i error /var/log/app.log            # ERROR, error, Error…
grep -c ERROR /var/log/app.log            # how many lines match
grep -n 'user=ravi' /var/log/app.log      # matches with line numbers
grep -v INFO /var/log/app.log             # everything except INFO
grep -B2 -A2 'code=502' /var/log/app.log  # 2 lines of context around each match
grep -r PORT /etc/app/                    # search every file under a folder`,
          },
        ],
      },
      {
        id: 'regex-basics',
        title: 'Search: patterns with regex',
        body: [
          'Sometimes you are looking for a **shape** rather than a fixed word — “any 5xx error code” or “lines that start with today’s date.” A **regular expression** (regex) describes that shape. Use **`grep -E`** and put the pattern in **single quotes** so the shell leaves it alone.',
        ],
        table: {
          headers: ['Piece', 'Meaning', 'Example'],
          rows: [
            ['`.`', 'Any one character', '`5.2` matches `502`, `512`…'],
            ['`[0-9]`', 'One character from a set', '`code=5[0-9]`'],
            ['`+` / `*`', 'Previous item one-or-more / zero-or-more times', '`[0-9]+` = a number'],
            ['`{n}`', 'Previous item exactly n times', '`[0-9]{2}` = two digits'],
            ['`^` / `$`', 'Start / end of the line', '`^2026` = lines starting with 2026'],
            ['`a|b`', 'Either side', '`WARN|ERROR`'],
          ],
        },
        code: {
          language: 'shell',
          code: `grep -E 'WARN|ERROR' /var/log/app.log      # either word
grep -E '^2026-10-04' /var/log/app.log     # lines that start with that date
grep -E 'code=5[0-9]{2}' /var/log/app.log  # any 5xx code: 500, 502, 503…`,
        },
        callout: {
          kind: 'warn',
          title: 'Regex is not a glob',
          body: [
            'Globs like **`*.log`** are expanded by the **shell** to match **file names**. Regex is read by **`grep`** to match **text inside lines** — there **`*`** means “repeat the previous item,” not “anything.”',
          ],
        },
      },
      {
        id: 'quick-reference',
        title: 'Quick reference',
        body: [],
        tableAfter: {
          headers: ['Job', 'Goal', 'Command'],
          rows: [
            ['Read', 'Size of a file', '`ls -lh file`, `wc -l file`'],
            ['Read', 'Latest lines / watch live', '`tail -n 50 file`, `tail -f file`'],
            ['Read', 'Scroll and search', '`less file`, then `/text`'],
            ['Edit', 'Edit by hand', '`vi file` → `i` … **Esc** → `:wq`'],
            ['Edit', 'Replace text in place', "`sed -i 's/old/new/' file`"],
            ['Search', 'Matching lines', '`grep -n pattern file`'],
            ['Search', 'Count matches', '`grep -c pattern file`'],
            ['Search', 'Search a folder', '`grep -r pattern dir/`'],
          ],
        },
      },
    ],
    takeaways: [
      '**Read**: size a file with **`ls -lh`** / **`wc -l`**; use **`less`** for big files, **`head`** / **`tail`** for the ends, **`tail -f`** to watch it grow.',
      '**Edit**: **`vi`** for hand edits (**`i`**, **Esc**, **`:wq`**, **`:q!`**); **`sed \'s/old/new/\'`** for one-line changes — preview before **`-i`**.',
      '**Search**: **`grep`** prints matching lines; **`-i -v -c -n -w -r`** cover most needs, and **`-E`** with a quoted regex matches shapes.',
    ],
    relatedLabsIntro: '',
    relatedLabs: [
      {
        challengeId: 'linux-03-read-the-order-logs',
        label: 'Read the Order Logs',
      },
      {
        challengeId: 'linux-04-grep-the-failed-payments',
        label: 'Grep the Failed Payments',
      },
      {
        challengeId: 'linux-06-fix-the-config-with-sed-and-vim',
        label: 'Fix the Config with sed and vim',
      },
    ],
  },
  ...LINUX_READINGS_EXTENDED,
];

/** Old slugs of readings that were merged into another post. */
const LINUX_READING_ALIASES: Record<string, string> = {
  'edit-configs-with-sed-and-vim': 'reading-and-searching-text',
};

export function getLinuxReading(slug: string | null | undefined): K8sReading | null {
  if (!slug) return null;
  const target = LINUX_READING_ALIASES[slug] ?? slug;
  return LINUX_READINGS.find((r) => r.slug === target || r.id === target) || null;
}

/** Readings inserted at the start of the Linux track (before lab 0). */
const LINUX_READINGS_BEFORE_LABS = ['meet-your-linux-machine'] as const;

/** Readings inserted immediately after a given challenge id. */
const LINUX_READINGS_AFTER_CHALLENGE: Record<string, string[]> = {
  'linux-00-first-shift-on-the-order-box': ['files-and-folders'],
  'linux-02-find-the-misplaced-configs': ['reading-and-searching-text'],
  'linux-04-grep-the-failed-payments': ['pipes-and-pipelines'],
  'linux-09-shared-drop-folder-for-notifications': ['users-groups-and-permissions'],
  'linux-10-hunt-the-runaway-process': ['processes-and-signals'],
  'linux-11-keep-the-batch-running-after-logout': ['background-jobs-and-nohup'],
  'linux-14-debug-a-failing-unit': ['systemd-and-journalctl'],
  'linux-16-rotate-notification-logs': ['cron-and-log-rotation', 'packages-and-pinning'],
  'linux-19-archive-and-roll-back-releases': ['storage-df-du-and-archives'],
  'linux-20-why-cant-order-reach-payment': ['networking-basics', 'ssh-keys-and-login'],
  'linux-24-loop-over-order-batches': ['bash-scripting-basics'],
};

/** Ordered mixed roadmap for the DevOps Linux panel: readings + challenges. */
export function listLinuxTrackItems(): K8sTrackItem[] {
  const panel = PLAY_DOMAINS.find((d) => d.id === 'devops-engineer')?.panels.find(
    (p) => p.id === 'linux',
  );
  const items: K8sTrackItem[] = LINUX_READINGS_BEFORE_LABS.map((readingId) => ({
    type: 'reading',
    id: `reading:${readingId}`,
    readingId,
  }));
  for (const challengeId of panel?.challengeIds ?? []) {
    items.push({ type: 'challenge', id: `challenge:${challengeId}`, challengeId });
    for (const readingId of LINUX_READINGS_AFTER_CHALLENGE[challengeId] ?? []) {
      items.push({ type: 'reading', id: `reading:${readingId}`, readingId });
    }
  }
  return items;
}
