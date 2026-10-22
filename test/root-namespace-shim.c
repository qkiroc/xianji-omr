#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>
#include <dlfcn.h>
uid_t getuid(void){return 1000;}
uid_t geteuid(void){return 1000;}
int stat(const char*p,struct stat*s){static int(*f)(const char*,struct stat*);if(!f)f=dlsym(RTLD_NEXT,"stat");int r=f(p,s);if(!r)s->st_uid=1000;return r;}
int lstat(const char*p,struct stat*s){static int(*f)(const char*,struct stat*);if(!f)f=dlsym(RTLD_NEXT,"lstat");int r=f(p,s);if(!r)s->st_uid=1000;return r;}
int fstat(int fd,struct stat*s){static int(*f)(int,struct stat*);if(!f)f=dlsym(RTLD_NEXT,"fstat");int r=f(fd,s);if(!r)s->st_uid=1000;return r;}
int stat64(const char*p,struct stat64*s){static int(*f)(const char*,struct stat64*);if(!f)f=dlsym(RTLD_NEXT,"stat64");int r=f(p,s);if(!r)s->st_uid=1000;return r;}
int lstat64(const char*p,struct stat64*s){static int(*f)(const char*,struct stat64*);if(!f)f=dlsym(RTLD_NEXT,"lstat64");int r=f(p,s);if(!r)s->st_uid=1000;return r;}
int fstat64(int fd,struct stat64*s){static int(*f)(int,struct stat64*);if(!f)f=dlsym(RTLD_NEXT,"fstat64");int r=f(fd,s);if(!r)s->st_uid=1000;return r;}
int __xstat(int v,const char*p,struct stat*s){static int(*f)(int,const char*,struct stat*);if(!f)f=dlsym(RTLD_NEXT,"__xstat");int r=f(v,p,s);if(!r)s->st_uid=1000;return r;}
int __lxstat(int v,const char*p,struct stat*s){static int(*f)(int,const char*,struct stat*);if(!f)f=dlsym(RTLD_NEXT,"__lxstat");int r=f(v,p,s);if(!r)s->st_uid=1000;return r;}
int __fxstat(int v,int fd,struct stat*s){static int(*f)(int,int,struct stat*);if(!f)f=dlsym(RTLD_NEXT,"__fxstat");int r=f(v,fd,s);if(!r)s->st_uid=1000;return r;}
