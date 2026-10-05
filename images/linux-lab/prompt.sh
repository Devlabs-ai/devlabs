# Sourced at the end of ~/.bashrc so it overrides Ubuntu's default prompt, which
# stays uncolored because kubectl exec does not pass TERM into the box.
if [ "$(id -u)" -eq 0 ]; then
  PS1='\[\e[1;31m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
else
  PS1='\[\e[1;32m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
fi
