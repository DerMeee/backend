import { createParamDecorator, ExecutionContext } from "@nestjs/common";


export const CurrentUser = createParamDecorator (
    (data: unknown, ctx: ExecutionContext) => {
        // Check if it's a WebSocket context
        if (ctx.getType() === 'ws') {
            const client = ctx.switchToWs().getClient();
            const user = client.data.user;
            console.log("user", user);
            return user;
        }
        
        // HTTP context
        const request = ctx.switchToHttp().getRequest();
        console.log("user", request.user);

        return request.user;
    }
)