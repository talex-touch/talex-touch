#define _DARWIN_C_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

struct operand {
    char path[PATH_MAX];
    const char *name;
    int parent_fd;
    struct stat entry;
};

/* Pin the parent directory so ancestor renames cannot redirect the swap. */
static int open_operand(const char *input, struct operand *operand)
{
    size_t length = strlen(input);
    if (length == 0 || length >= sizeof(operand->path)) {
        fprintf(stderr, "tuff-native-update: invalid or overlong path: %s\n", input);
        return -1;
    }
    memcpy(operand->path, input, length + 1);
    while (length > 1 && operand->path[length - 1] == '/')
        operand->path[--length] = '\0';

    char *separator = strrchr(operand->path, '/');
    const char *parent = ".";
    operand->name = operand->path;
    if (separator != NULL) {
        operand->name = separator + 1;
        if (separator == operand->path) {
            parent = "/";
        } else {
            *separator = '\0';
            parent = operand->path;
        }
    }
    if (operand->name[0] == '\0' || strcmp(operand->name, ".") == 0 ||
        strcmp(operand->name, "..") == 0) {
        fprintf(stderr, "tuff-native-update: path must name a directory entry: %s\n", input);
        return -1;
    }
    operand->parent_fd = open(parent, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (operand->parent_fd == -1) {
        fprintf(stderr, "tuff-native-update: cannot open parent of %s: %s\n", input, strerror(errno));
        return -1;
    }
    if (fstatat(operand->parent_fd, operand->name, &operand->entry, AT_SYMLINK_NOFOLLOW) == -1) {
        fprintf(stderr, "tuff-native-update: cannot inspect %s: %s\n", input, strerror(errno));
        return -1;
    }
    if (!S_ISDIR(operand->entry.st_mode)) {
        fprintf(stderr, "tuff-native-update: refusing symlink or non-directory: %s\n", input);
        return -1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    if (argc != 4 || strcmp(argv[1], "--swap") != 0) {
        fprintf(stderr, "Usage: tuff-native-update --swap <left-directory> <right-directory>\n");
        return 2;
    }

    struct operand left = { .parent_fd = -1 };
    struct operand right = { .parent_fd = -1 };
    int result = 1;
    if (open_operand(argv[2], &left) != 0 || open_operand(argv[3], &right) != 0)
        goto done;
    if (left.entry.st_dev != right.entry.st_dev) {
        fprintf(stderr, "tuff-native-update: refusing cross-device swap: %s <-> %s\n", argv[2], argv[3]);
        goto done;
    }
    if (left.entry.st_ino == right.entry.st_ino) {
        fprintf(stderr, "tuff-native-update: refusing swap of the same directory: %s <-> %s\n", argv[2], argv[3]);
        goto done;
    }

    /* Darwin's fd-relative renamex_np variant: one atomic exchange, never a copy or deletion. */
    if (renameatx_np(left.parent_fd, left.name, right.parent_fd, right.name, RENAME_SWAP) == -1) {
        fprintf(stderr, "tuff-native-update: atomic swap failed for %s <-> %s: %s\n",
                argv[2], argv[3], strerror(errno));
        goto done;
    }
    result = 0;

done:
    if (left.parent_fd != -1)
        close(left.parent_fd);
    if (right.parent_fd != -1)
        close(right.parent_fd);
    return result;
}
